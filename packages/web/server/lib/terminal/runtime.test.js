import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTerminalRuntime } from './runtime.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createRuntime(server, overrides = {}) {
  const app = overrides.app ?? {
    post() {},
    get() {},
    delete() {},
  };

  return createTerminalRuntime({
    app,
    server,
    express: { text: () => (_req, _res, next) => next?.() },
    fs,
    path,
    uiAuthController: null,
    buildAugmentedPath: () => process.env.PATH || '',
    searchPathFor: () => null,
    isExecutable: () => false,
    isRequestOriginAllowed: async () => true,
    rejectWebSocketUpgrade() {},
    TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 30_000,
    TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1_000,
    TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW: 3,
    ...overrides,
  });
}

describe('terminal runtime', () => {
  it('rejects regular files as terminal working directories', async () => {
    const previousWorkspaceRoot = process.env.OPENCHAMBER_WORKSPACE_ROOT;
    const previousWorkspaceLockdown = process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN;
    const workspaceRoot = '/tmp/openchamber-terminal-test-root';
    const regularFilePath = path.join(workspaceRoot, 'not-a-directory');
    const postRoutes = new Map();
    const app = {
      post(route, ...handlers) {
        postRoutes.set(route, handlers.at(-1));
      },
      get() {},
      delete() {},
    };
    const server = new EventEmitter();
    const runtime = createRuntime(server, {
      app,
      fs: {
        promises: {
          realpath: async (targetPath) => targetPath,
          stat: async () => ({ isDirectory: () => false }),
        },
      },
      uiAuthController: { enabled: false },
      buildAugmentedPath: () => '',
      TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 1000,
      TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1000,
    });

    try {
      process.env.OPENCHAMBER_WORKSPACE_ROOT = workspaceRoot;
      process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN = 'true';
      const createRoute = postRoutes.get('/api/terminal/create');
      const res = createResponse();

      await createRoute({ body: { cwd: regularFilePath } }, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('Invalid working directory');
    } finally {
      if (previousWorkspaceRoot === undefined) {
        delete process.env.OPENCHAMBER_WORKSPACE_ROOT;
      } else {
        process.env.OPENCHAMBER_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousWorkspaceLockdown === undefined) {
        delete process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN;
      } else {
        process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN = previousWorkspaceLockdown;
      }
      await runtime.shutdown();
    }
  });

  it('rejects terminal working directories outside workspace lockdown', async () => {
    const previousWorkspaceRoot = process.env.OPENCHAMBER_WORKSPACE_ROOT;
    const previousWorkspaceLockdown = process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN;
    const workspaceRoot = '/tmp/openchamber-terminal-test-root';
    const postRoutes = new Map();
    const app = {
      post(route, ...handlers) {
        postRoutes.set(route, handlers.at(-1));
      },
      get() {},
      delete() {},
    };
    const server = new EventEmitter();
    const runtime = createRuntime(server, {
      app,
      fs: {
        promises: {
          realpath: async (targetPath) => targetPath,
          stat: async () => {
            throw new Error('stat should not be called for paths outside the workspace');
          },
        },
      },
      uiAuthController: { enabled: false },
      buildAugmentedPath: () => '',
      TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 1000,
      TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1000,
    });

    try {
      process.env.OPENCHAMBER_WORKSPACE_ROOT = workspaceRoot;
      process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN = 'true';
      const createRoute = postRoutes.get('/api/terminal/create');
      const res = createResponse();

      await createRoute({ body: { cwd: '/tmp/outside-workspace' } }, res);

      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toContain('Path is outside workspace');
    } finally {
      if (previousWorkspaceRoot === undefined) {
        delete process.env.OPENCHAMBER_WORKSPACE_ROOT;
      } else {
        process.env.OPENCHAMBER_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousWorkspaceLockdown === undefined) {
        delete process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN;
      } else {
        process.env.OPENCHAMBER_WORKSPACE_LOCKDOWN = previousWorkspaceLockdown;
      }
      await runtime.shutdown();
    }
  });

  it('removes its websocket upgrade listener on shutdown', async () => {
    const server = new EventEmitter();
    const runtime = createRuntime(server);

    expect(server.listenerCount('upgrade')).toBe(1);

    await runtime.shutdown();

    expect(server.listenerCount('upgrade')).toBe(0);
  });
});
