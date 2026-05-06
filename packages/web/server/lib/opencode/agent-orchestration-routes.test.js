import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerAgentOrchestrationRoutes } from './agent-orchestration-routes.js';

const createConfigPayload = (overrides = {}) => ({
  mode: {
    effective: 'native',
    user: 'native',
    project: null,
    conflicts: [],
    configPaths: ['/tmp/opencode.jsonc'],
    tuiConfigPath: '/tmp/tui.jsonc',
    mtimeMsByPath: { '/tmp/opencode.jsonc': 123, '/tmp/tui.jsonc': 456 },
  },
  packages: {
    slim: { packageName: 'oh-my-opencode-slim', entry: 'oh-my-opencode-slim', installed: false, version: null, cachePath: '/tmp/slim' },
    omo: { packageName: 'oh-my-opencode', entry: 'oh-my-openagent', installed: false, version: null, cachePath: '/tmp/omo' },
  },
  omo: {},
  slim: {},
  ...overrides,
});

const createSlimPayload = (overrides = {}) => ({
  plugin: { detected: false, enabled: false, entry: null },
  target: { scope: 'user', path: '/tmp/oh-my-opencode-slim.jsonc', exists: true, format: 'jsonc', mtimeMs: 123 },
  project: { path: null, exists: false, overriddenKeys: [] },
  raw: {},
  effective: {},
  presets: [],
  agents: [],
  ...overrides,
});

describe('agent orchestration routes', () => {
  it('loads unified config for the requested project directory', async () => {
    const app = express();
    app.use(express.json());
    const readAgentOrchestrationConfig = vi.fn(() => createConfigPayload());

    registerAgentOrchestrationRoutes(app, {
      readAgentOrchestrationConfig,
      setAgentOrchestrationMode: vi.fn(),
      runPackageAction: vi.fn(),
      readSlimConfig: vi.fn(),
      saveSlimConfig: vi.fn(),
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/repo/project', error: null })),
    });

    const response = await request(app)
      .get('/api/agent-orchestration/config?directory=%2Frepo%2Fproject')
      .expect(200);

    expect(readAgentOrchestrationConfig).toHaveBeenCalledWith({ directory: '/repo/project' });
    expect(response.body.mode.effective).toBe('native');
  });

  it('switches mode, refreshes OpenCode, and returns the reloaded config', async () => {
    const app = express();
    app.use(express.json());
    const setAgentOrchestrationMode = vi.fn(() => createConfigPayload({ mode: { ...createConfigPayload().mode, effective: 'slim', user: 'slim' } }));
    const refreshOpenCodeAfterConfigChange = vi.fn(async () => undefined);

    registerAgentOrchestrationRoutes(app, {
      clientReloadDelayMs: 25,
      readAgentOrchestrationConfig: vi.fn(),
      setAgentOrchestrationMode,
      runPackageAction: vi.fn(),
      readSlimConfig: vi.fn(),
      saveSlimConfig: vi.fn(),
      refreshOpenCodeAfterConfigChange,
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/repo/project', error: null })),
    });

    const response = await request(app)
      .patch('/api/agent-orchestration/mode?directory=%2Frepo%2Fproject')
      .send({
        mode: 'slim',
        expectedMtimeMsByPath: { '/tmp/opencode.jsonc': 123 },
      })
      .expect(200);

    expect(setAgentOrchestrationMode).toHaveBeenCalledWith({
      directory: '/repo/project',
      mode: 'slim',
      expectedMtimeMsByPath: { '/tmp/opencode.jsonc': 123 },
    });
    expect(refreshOpenCodeAfterConfigChange).toHaveBeenCalledWith('agent orchestration mode updated');
    expect(response.body).toMatchObject({
      success: true,
      requiresReload: true,
      reloadDelayMs: 25,
      config: { mode: { effective: 'slim' } },
    });
  });

  it('returns 409 when mode config changed on disk', async () => {
    const app = express();
    app.use(express.json());
    const error = new Error('Config was modified outside OpenChamber. Reload before saving again.');
    error.code = 'CONFIG_MODIFIED';

    registerAgentOrchestrationRoutes(app, {
      readAgentOrchestrationConfig: vi.fn(),
      setAgentOrchestrationMode: vi.fn(() => {
        throw error;
      }),
      runPackageAction: vi.fn(),
      readSlimConfig: vi.fn(),
      saveSlimConfig: vi.fn(),
      refreshOpenCodeAfterConfigChange: vi.fn(),
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: null, error: null })),
    });

    const response = await request(app)
      .patch('/api/agent-orchestration/mode')
      .send({ mode: 'native', expectedMtimeMsByPath: {} })
      .expect(409);

    expect(response.body.error).toContain('modified outside OpenChamber');
  });

  it('saves Slim config and returns the project-aware reloaded config', async () => {
    const app = express();
    app.use(express.json());
    const saveSlimConfig = vi.fn();
    const readSlimConfig = vi.fn(() => createSlimPayload({ raw: { preset: 'openai' } }));
    const refreshOpenCodeAfterConfigChange = vi.fn(async () => undefined);

    registerAgentOrchestrationRoutes(app, {
      clientReloadDelayMs: 25,
      readAgentOrchestrationConfig: vi.fn(),
      setAgentOrchestrationMode: vi.fn(),
      runPackageAction: vi.fn(),
      readSlimConfig,
      saveSlimConfig,
      refreshOpenCodeAfterConfigChange,
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/repo/project', error: null })),
    });

    const response = await request(app)
      .patch('/api/agent-orchestration/slim/config?directory=%2Frepo%2Fproject')
      .send({ expectedMtimeMs: 123, config: { preset: 'openai' } })
      .expect(200);

    expect(saveSlimConfig).toHaveBeenCalledWith({
      expectedMtimeMs: 123,
      config: { preset: 'openai' },
    });
    expect(readSlimConfig).toHaveBeenCalledWith({ directory: '/repo/project' });
    expect(refreshOpenCodeAfterConfigChange).toHaveBeenCalledWith('oh-my-opencode-slim config updated');
    expect(response.body.config.raw.preset).toBe('openai');
  });

  it('validates the requested directory before saving Slim config', async () => {
    const app = express();
    app.use(express.json());
    const saveSlimConfig = vi.fn();

    registerAgentOrchestrationRoutes(app, {
      readAgentOrchestrationConfig: vi.fn(),
      setAgentOrchestrationMode: vi.fn(),
      runPackageAction: vi.fn(),
      readSlimConfig: vi.fn(),
      saveSlimConfig,
      refreshOpenCodeAfterConfigChange: vi.fn(),
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: null, error: 'Invalid directory' })),
    });

    const response = await request(app)
      .patch('/api/agent-orchestration/slim/config?directory=%2Fbad')
      .send({ expectedMtimeMs: 123, config: { preset: 'openai' } })
      .expect(400);

    expect(response.body.error).toBe('Invalid directory');
    expect(saveSlimConfig).not.toHaveBeenCalled();
  });

  it('runs package actions and refreshes OpenCode', async () => {
    const app = express();
    app.use(express.json());
    const runPackageAction = vi.fn(() => ({ success: true, action: 'update', plugin: 'slim', config: createConfigPayload() }));
    const refreshOpenCodeAfterConfigChange = vi.fn(async () => undefined);

    registerAgentOrchestrationRoutes(app, {
      clientReloadDelayMs: 25,
      readAgentOrchestrationConfig: vi.fn(),
      setAgentOrchestrationMode: vi.fn(),
      runPackageAction,
      readSlimConfig: vi.fn(),
      saveSlimConfig: vi.fn(),
      refreshOpenCodeAfterConfigChange,
      resolveOptionalProjectDirectory: vi.fn(async () => ({ directory: '/repo/project', error: null })),
    });

    const response = await request(app)
      .post('/api/agent-orchestration/package-action?directory=%2Frepo%2Fproject')
      .send({ plugin: 'slim', action: 'update', clearCache: true })
      .expect(200);

    expect(runPackageAction).toHaveBeenCalledWith({
      directory: '/repo/project',
      plugin: 'slim',
      action: 'update',
      deleteConfig: false,
      clearCache: true,
    });
    expect(refreshOpenCodeAfterConfigChange).toHaveBeenCalledWith('agent orchestration package update');
    expect(response.body.requiresReload).toBe(true);
  });
});
