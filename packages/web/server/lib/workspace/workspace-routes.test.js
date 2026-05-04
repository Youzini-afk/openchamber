import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

let tempDir;
let workspaceRoot;

async function loadRoutesModule() {
  return import(`./workspace-routes.js?test=${Date.now()}-${Math.random()}`);
}

async function createApp(env = {}) {
  const { registerWorkspaceRoutes } = await loadRoutesModule();
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerWorkspaceRoutes(app, {
    env: {
      OPENCHAMBER_WORKSPACE_ROOT: workspaceRoot,
      OPENCHAMBER_WORKSPACE_TRASH: 'true',
      OPENCHAMBER_WORKSPACE_MAX_READ_MB: '1',
      ...env,
    },
    fsPromises: fs.promises,
    pathModule: path,
    osModule: os,
    readSettingsFromDiskMigrated: vi.fn(async () => ({ projects: [] })),
    persistSettings: vi.fn(async (changes) => ({ ...changes })),
    sanitizeProjects: (value) => Array.isArray(value) ? value : [],
  });
  return app;
}

describe('workspace routes', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-workspace-routes-'));
    workspaceRoot = path.join(tempDir, 'workspace');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    workspaceRoot = undefined;
  });

  it('creates and reports the workspace root when it does not exist', async () => {
    const app = await createApp();

    const response = await request(app)
      .get('/api/workspace/root')
      .expect(200);

    expect(fs.existsSync(workspaceRoot)).toBe(true);
    expect(response.body).toMatchObject({
      root: workspaceRoot,
      relativeRoot: '',
      limits: {
        maxReadBytes: 1024 * 1024,
      },
    });
  });

  it('creates folders, lists them as projects, and soft-deletes entries into trash', async () => {
    const app = await createApp();

    await request(app)
      .post('/api/workspace/folder')
      .send({ path: 'demo' })
      .expect(200);

    const list = await request(app)
      .get('/api/workspace/list')
      .expect(200);

    expect(list.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'demo',
        relativePath: 'demo',
        type: 'directory',
        isProject: true,
      }),
    ]));

    const deleted = await request(app)
      .delete('/api/workspace/entry')
      .send({ path: 'demo' })
      .expect(200);

    expect(deleted.body).toMatchObject({ success: true, trashed: true });
    expect(fs.existsSync(path.join(workspaceRoot, 'demo'))).toBe(false);
    expect(fs.existsSync(deleted.body.trashPath)).toBe(true);
    expect(deleted.body.trashPath.startsWith(path.join(workspaceRoot, '.trash'))).toBe(true);
  });

  it('lists an empty trash directory explicitly while keeping it hidden from root', async () => {
    const app = await createApp();

    const rootList = await request(app)
      .get('/api/workspace/list')
      .expect(200);
    expect(rootList.body.entries.map((entry) => entry.name)).not.toContain('.trash');

    const trashList = await request(app)
      .get('/api/workspace/list')
      .query({ path: '.trash' })
      .expect(200);

    expect(trashList.body).toMatchObject({
      relativePath: '.trash',
      entries: [],
    });
    expect(fs.existsSync(path.join(workspaceRoot, '.trash'))).toBe(true);
  });

  it('rejects writes when expectedMtimeMs no longer matches disk state', async () => {
    const app = await createApp();
    fs.mkdirSync(path.join(workspaceRoot, 'demo'), { recursive: true });
    const filePath = path.join(workspaceRoot, 'demo', 'note.txt');
    fs.writeFileSync(filePath, 'first');
    const originalMtime = fs.statSync(filePath).mtimeMs;
    fs.writeFileSync(filePath, 'external change');
    const shiftedMtime = new Date(originalMtime + 60_000);
    fs.utimesSync(filePath, shiftedMtime, shiftedMtime);

    const response = await request(app)
      .put('/api/workspace/write')
      .send({
        path: 'demo/note.txt',
        content: 'openchamber change',
        expectedMtimeMs: originalMtime,
      })
      .expect(409);

    expect(response.body.error).toMatch(/modified/i);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external change');
  });

  it('refuses to read files larger than the configured text limit', async () => {
    const app = await createApp({ OPENCHAMBER_WORKSPACE_MAX_READ_MB: '0.0001' });
    fs.mkdirSync(path.join(workspaceRoot, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'demo', 'big.txt'), 'x'.repeat(1024));

    const response = await request(app)
      .get('/api/workspace/read')
      .query({ path: 'demo/big.txt' })
      .expect(413);

    expect(response.body.error).toMatch(/too large/i);
  });
});
