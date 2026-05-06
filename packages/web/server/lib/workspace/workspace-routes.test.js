import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { create as tarCreate } from 'tar';

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
        maxArchiveBytes: 1024 * 1024 * 1024,
        maxExtractBytes: 3 * 1024 * 1024 * 1024,
        maxExtractFiles: 30000,
        archivePreviewLimit: 500,
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

  it('uploads zip archives through multipart without extracting them', async () => {
    const app = await createApp();
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('hello'));

    const upload = await request(app)
      .post('/api/workspace/upload')
      .field('path', 'demo')
      .attach('files', zip.toBuffer(), 'demo.zip')
      .expect(200);

    expect(upload.body.entries).toEqual([
      expect.objectContaining({
        name: 'demo.zip',
        relativePath: 'demo/demo.zip',
        type: 'file',
      }),
    ]);
    expect(fs.existsSync(path.join(workspaceRoot, 'demo', 'demo.zip'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, 'demo', 'README.md'))).toBe(false);
  });

  it('previews and extracts zip archives into new folders with rename conflicts', async () => {
    const app = await createApp();
    fs.mkdirSync(path.join(workspaceRoot, 'demo'), { recursive: true });
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('hello'));
    zip.addFile('src/index.ts', Buffer.from('export {};'));
    fs.writeFileSync(path.join(workspaceRoot, 'demo', 'demo.zip'), zip.toBuffer());

    const preview = await request(app)
      .get('/api/workspace/archive/preview')
      .query({ path: 'demo/demo.zip' })
      .expect(200);

    expect(preview.body).toMatchObject({
      format: 'zip',
      totalFiles: 2,
      totalDirectories: 0,
      totalBytes: 15,
      truncated: false,
    });
    expect(preview.body.entries.map((entry) => entry.path)).toEqual(['README.md', 'src/index.ts']);

    const firstExtract = await request(app)
      .post('/api/workspace/archive/extract')
      .send({
        path: 'demo/demo.zip',
        destination: 'demo/demo',
        mode: 'new-folder',
        conflict: 'rename',
      })
      .expect(200);

    expect(firstExtract.body).toMatchObject({
      success: true,
      destination: 'demo/demo',
      filesCreated: 2,
      conflictsRenamed: 0,
    });
    expect(fs.readFileSync(path.join(workspaceRoot, 'demo', 'demo', 'README.md'), 'utf8')).toBe('hello');

    const secondExtract = await request(app)
      .post('/api/workspace/archive/extract')
      .send({
        path: 'demo/demo.zip',
        destination: 'demo/demo',
        mode: 'new-folder',
        conflict: 'rename',
      })
      .expect(200);

    expect(secondExtract.body).toMatchObject({
      destination: 'demo/demo (1)',
      conflictsRenamed: 1,
    });
    expect(fs.existsSync(path.join(workspaceRoot, 'demo', 'demo (1)', 'src', 'index.ts'))).toBe(true);
  });

  it('extracts tar.gz archives and can delete the source archive after success', async () => {
    const app = await createApp();
    const sourceDir = path.join(tempDir, 'tar-source');
    fs.mkdirSync(path.join(sourceDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'src', 'main.ts'), 'console.log("ok");');
    fs.mkdirSync(path.join(workspaceRoot, 'archives'), { recursive: true });
    const archivePath = path.join(workspaceRoot, 'archives', 'code.tgz');
    await tarCreate({ gzip: true, file: archivePath, cwd: sourceDir }, ['src']);

    const preview = await request(app)
      .get('/api/workspace/archive/preview')
      .query({ path: 'archives/code.tgz' })
      .expect(200);

    expect(preview.body.format).toBe('tgz');
    expect(preview.body.entries.map((entry) => entry.path)).toContain('src/main.ts');

    await request(app)
      .post('/api/workspace/archive/extract')
      .send({
        path: 'archives/code.tgz',
        destination: 'archives/code',
        mode: 'new-folder',
        conflict: 'rename',
        deleteArchive: true,
      })
      .expect(200);

    expect(fs.existsSync(archivePath)).toBe(false);
    expect(fs.readFileSync(path.join(workspaceRoot, 'archives', 'code', 'src', 'main.ts'), 'utf8')).toBe('console.log("ok");');
  });

  it('rejects archive entries that try to escape the workspace', async () => {
    const app = await createApp();
    fs.mkdirSync(path.join(workspaceRoot, 'demo'), { recursive: true });
    const zip = new AdmZip();
    zip.addFile('C:/evil.txt', Buffer.from('nope'));
    fs.writeFileSync(path.join(workspaceRoot, 'demo', 'evil.zip'), zip.toBuffer());

    const response = await request(app)
      .get('/api/workspace/archive/preview')
      .query({ path: 'demo/evil.zip' })
      .expect(400);

    expect(response.body.error).toMatch(/outside workspace|relative|empty|NUL|path/i);
    expect(fs.existsSync(path.join(workspaceRoot, 'evil.txt'))).toBe(false);
  });

  it('honors extraction conflict errors without writing final files', async () => {
    const app = await createApp();
    fs.mkdirSync(path.join(workspaceRoot, 'demo', 'target'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'demo', 'target', 'README.md'), 'existing');
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('new'));
    fs.writeFileSync(path.join(workspaceRoot, 'demo', 'demo.zip'), zip.toBuffer());

    const response = await request(app)
      .post('/api/workspace/archive/extract')
      .send({
        path: 'demo/demo.zip',
        destination: 'demo/target',
        mode: 'merge',
        conflict: 'error',
      })
      .expect(409);

    expect(response.body.error).toMatch(/destination/i);
    expect(fs.readFileSync(path.join(workspaceRoot, 'demo', 'target', 'README.md'), 'utf8')).toBe('existing');
    const leftovers = fs.readdirSync(workspaceRoot).filter((name) => name.startsWith('.extracting-'));
    expect(leftovers).toEqual([]);
  });

  it('clones a repository into the selected workspace directory', async () => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      return;
    }

    const app = await createApp();
    const remotePath = path.join(tempDir, 'remote.git');
    execFileSync('git', ['init', '--bare', remotePath], { stdio: 'ignore' });
    fs.mkdirSync(path.join(workspaceRoot, 'projects'), { recursive: true });

    await request(app)
      .post('/api/workspace/git/clone')
      .send({
        path: 'projects',
        url: remotePath,
        directoryName: 'copy',
      })
      .expect(200);

    expect(fs.existsSync(path.join(workspaceRoot, 'projects', 'copy', '.git'))).toBe(true);

    const list = await request(app)
      .get('/api/workspace/list')
      .query({ path: 'projects' })
      .expect(200);

    expect(list.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'copy',
        relativePath: 'projects/copy',
        type: 'directory',
      }),
    ]));
  });

  it('rejects clone destination folders that escape the current directory', async () => {
    const app = await createApp();
    fs.mkdirSync(path.join(workspaceRoot, 'projects'), { recursive: true });

    const response = await request(app)
      .post('/api/workspace/git/clone')
      .send({
        path: 'projects',
        url: 'https://example.com/repo.git',
        directoryName: '../outside',
      })
      .expect(400);

    expect(response.body.error).toMatch(/simple folder name/i);
    expect(fs.existsSync(path.join(workspaceRoot, 'outside'))).toBe(false);
  });
});
