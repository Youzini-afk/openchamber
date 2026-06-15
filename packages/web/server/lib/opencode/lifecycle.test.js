import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

const { createOpenCodeLifecycleRuntime } = await import('./lifecycle.js');

const originalOpencodeBinary = process.env.OPENCODE_BINARY;
const originalOpencodeConfigContent = process.env.OPENCODE_CONFIG_CONTENT;
const originalFetch = globalThis.fetch;
const originalPath = process.env.PATH;

beforeEach(() => {
  delete process.env.OPENCODE_CONFIG_CONTENT;
});

afterEach(() => {
  spawnMock.mockReset();
  globalThis.fetch = originalFetch;
  if (typeof originalOpencodeBinary === 'string') {
    process.env.OPENCODE_BINARY = originalOpencodeBinary;
  } else {
    delete process.env.OPENCODE_BINARY;
  }

  if (typeof originalOpencodeConfigContent === 'string') {
    process.env.OPENCODE_CONFIG_CONTENT = originalOpencodeConfigContent;
  } else {
    delete process.env.OPENCODE_CONFIG_CONTENT;
  }

  if (typeof originalPath === 'string') {
    process.env.PATH = originalPath;
  } else {
    delete process.env.PATH;
  }
});

const createMockChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 12345;
  child.kill = vi.fn(() => {
    child.signalCode = 'SIGTERM';
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  });
  return child;
};

const createRuntime = (overrides = {}) => {
  const state = {
    openCodeWorkingDirectory: '/tmp/project',
    openCodeProcess: null,
    openCodePort: null,
    openCodeBaseUrl: null,
    currentRestartPromise: null,
    isRestartingOpenCode: false,
    openCodeApiPrefix: '',
    openCodeApiPrefixDetected: false,
    openCodeApiDetectionTimer: null,
    lastOpenCodeError: null,
    isOpenCodeReady: false,
    openCodeNotReadySince: 0,
    isExternalOpenCode: false,
    isShuttingDown: false,
    healthCheckInterval: null,
    expressApp: null,
    useWslForOpencode: false,
    resolvedWslBinary: null,
    resolvedWslOpencodePath: null,
    resolvedWslDistro: null,
  };

  return createOpenCodeLifecycleRuntime({
    state,
    env: {
      ENV_CONFIGURED_OPENCODE_PORT: 45678,
      ENV_CONFIGURED_OPENCODE_HOST: null,
      ENV_EFFECTIVE_PORT: 3001,
      ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
      ENV_SKIP_OPENCODE_START: false,
    },
    syncToHmrState: vi.fn(),
    syncFromHmrState: vi.fn(),
    getOpenCodeAuthHeaders: () => ({}),
    buildOpenCodeUrl: (route) => `http://127.0.0.1:45678${route}`,
    waitForReady: vi.fn(async () => true),
    normalizeApiPrefix: vi.fn(() => ''),
    applyOpencodeBinaryFromSettings: vi.fn(async () => null),
    ensureOpencodeCliEnv: vi.fn(),
    ensureLocalOpenCodeServerPassword: vi.fn(async () => 'password'),
    resolveManagedOpenCodeLaunchSpec: vi.fn((binary) => ({ binary, args: [], wrapperType: null })),
    buildWslExecArgs: vi.fn((args, distro) => (distro ? ['-d', distro, '--exec', ...args] : ['--exec', ...args])),
    setOpenCodePort: vi.fn((port) => {
      state.openCodePort = port;
    }),
    setDetectedOpenCodeApiPrefix: vi.fn(),
    setupProxy: vi.fn(),
    ensureOpenCodeApiPrefix: vi.fn(),
    clearResolvedOpenCodeBinary: vi.fn(),
    buildAugmentedPath: vi.fn(() => '/home/user/.bun/bin:/usr/local/bin:/usr/bin'),
    buildManagedOpenCodePath: vi.fn(() => '/home/user/.bun/bin:/usr/local/bin:/usr/bin'),
    getManagedOpenCodeShellEnvSnapshot: vi.fn(() => ({
      PATH: '/home/user/.bun/bin:/usr/local/bin:/usr/bin',
      SHELL_ONLY: 'yes',
      OPENCODE_SERVER_PASSWORD: 'shell-password',
    })),
    spawnProcess: spawnMock,
    spawnSyncProcess: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
    ...overrides,
  });
};

describe('OpenCode lifecycle', () => {
  it('launches managed OpenCode with the managed PATH', async () => {
    delete process.env.OPENCODE_BINARY;
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();
    const [binary, args, options] = spawnMock.mock.calls[0];

    expect(binary).toBe('opencode');
    expect(args).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '45678']);
    expect(options.env.PATH).toBe('/home/user/.bun/bin:/usr/local/bin:/usr/bin');
    expect(options.env.SHELL_ONLY).toBe('yes');
    expect(options.env.OPENCODE_SERVER_PASSWORD).toBe('password');
    expect(options.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER).toBe('1');
    expect(JSON.parse(options.env.OPENCODE_CONFIG_CONTENT).plugin[0]).toMatch(/openai-stream-normalizer-plugin\.mjs$/);

    await server.close();
  });

  it('preserves existing OPENCODE_CONFIG_CONTENT when injecting the managed stream normalizer', async () => {
    delete process.env.OPENCODE_BINARY;
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { test: {} }, plugin: ['existing-plugin'] });
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];
    const inlineConfig = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);

    expect(inlineConfig.provider).toEqual({ test: {} });
    expect(inlineConfig.plugin[0]).toBe('existing-plugin');
    expect(inlineConfig.plugin[1]).toMatch(/openai-stream-normalizer-plugin\.mjs$/);

    await server.close();
  });

  it('falls back to buildAugmentedPath when buildManagedOpenCodePath is not provided', async () => {
    delete process.env.OPENCODE_BINARY;
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      buildManagedOpenCodePath: undefined,
      buildAugmentedPath: vi.fn(() => '/home/user/.cargo/bin:/usr/local/bin'),
    });
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];

    expect(options.env.PATH).toBe('/home/user/.cargo/bin:/usr/local/bin');

    await server.close();
  });

  it('falls back to process.env.PATH when neither build function is provided', async () => {
    delete process.env.OPENCODE_BINARY;
    process.env.PATH = '/usr/bin:/bin';
    const child = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return child;
    });

    const runtime = createRuntime({
      buildManagedOpenCodePath: undefined,
      buildAugmentedPath: undefined,
    });
    const server = await runtime.startOpenCode();
    const [, , options] = spawnMock.mock.calls[0];

    expect(options.env.PATH).toBe('/usr/bin:/bin');

    await server.close();
  });

  it('launches explicitly configured WSL OpenCode on Windows', async () => {
    const originalPlatform = process.platform;
    const originalOpenChamberNormalizer = process.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER;
    delete process.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      delete process.env.OPENCODE_BINARY;
      const child = createMockChild();
      spawnMock.mockImplementationOnce(() => {
        queueMicrotask(() => {
          child.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
        });
        return child;
      });

      const state = {
        openCodeWorkingDirectory: '/tmp/project',
        openCodeProcess: null,
        openCodePort: null,
        openCodeBaseUrl: null,
        currentRestartPromise: null,
        isRestartingOpenCode: false,
        openCodeApiPrefix: '',
        openCodeApiPrefixDetected: false,
        openCodeApiDetectionTimer: null,
        lastOpenCodeError: null,
        isOpenCodeReady: false,
        openCodeNotReadySince: 0,
        isExternalOpenCode: false,
        isShuttingDown: false,
        healthCheckInterval: null,
        expressApp: null,
        useWslForOpencode: true,
        resolvedWslBinary: 'C:\\Windows\\System32\\wsl.exe',
        resolvedWslOpencodePath: '/usr/local/bin/opencode',
        resolvedWslDistro: 'Ubuntu',
      };
      const buildWslExecArgs = vi.fn((args, distro) => ['-d', distro, '--exec', ...args]);
      const runtime = createRuntime({ state, buildWslExecArgs });
      const server = await runtime.startOpenCode();
      const [binary, args] = spawnMock.mock.calls[0];

      expect(binary).toBe('C:\\Windows\\System32\\wsl.exe');
      expect(args).toEqual(['-d', 'Ubuntu', '--exec', '/usr/local/bin/opencode', 'serve', '--hostname', '127.0.0.1', '--port', '45678']);
      expect(buildWslExecArgs).toHaveBeenCalledWith(['/usr/local/bin/opencode', 'serve', '--hostname', '127.0.0.1', '--port', '45678'], 'Ubuntu');

      const [, , options] = spawnMock.mock.calls[0];
      expect(options.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER).toBeUndefined();
      expect(options.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();

      await server.close();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (typeof originalOpenChamberNormalizer === 'string') {
        process.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER = originalOpenChamberNormalizer;
      } else {
        delete process.env.OPENCHAMBER_OPENAI_STREAM_NORMALIZER;
      }
    }
  });

  it('reports the binary when managed OpenCode exits before becoming ready', async () => {
    delete process.env.OPENCODE_BINARY;
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        firstChild.emit('exit', null, 'SIGTERM');
      });
      return firstChild;
    });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        secondChild.emit('exit', null, 'SIGTERM');
      });
      return secondChild;
    });

    const runtime = createRuntime();

    await expect(runtime.startOpenCode()).rejects.toThrow('OpenCode process exited before serving with signal SIGTERM. Binary used: opencode. No stdout/stderr captured');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry managed startup when the configured OpenCode binary is invalid', async () => {
    delete process.env.OPENCODE_BINARY;
    const error = new Error('Configured OpenCode binary not found: /missing/opencode');
    error.code = 'OPENCODE_BINARY_INVALID';
    const applyOpencodeBinaryFromSettings = vi.fn(async () => {
      throw error;
    });

    const runtime = createRuntime({ applyOpencodeBinaryFromSettings });

    await expect(runtime.startOpenCode()).rejects.toThrow('Configured OpenCode binary not found: /missing/opencode');
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledTimes(1);
    expect(applyOpencodeBinaryFromSettings).toHaveBeenCalledWith({ strict: true });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('retries managed OpenCode startup once after a pre-ready exit', async () => {
    delete process.env.OPENCODE_BINARY;
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        firstChild.emit('exit', null, 'SIGTERM');
      });
      return firstChild;
    });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        secondChild.stdout.emit('data', 'opencode server listening on http://127.0.0.1:45678\n');
      });
      return secondChild;
    });

    const runtime = createRuntime();
    const server = await runtime.startOpenCode();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    await server.close();
  });

  it('restarts the shared global event hub around a config refresh', async () => {
    const calls = [];
    const state = {
      openCodeWorkingDirectory: '/tmp/project',
      openCodeProcess: null,
      openCodePort: 45678,
      openCodeBaseUrl: null,
      currentRestartPromise: null,
      isRestartingOpenCode: false,
      openCodeApiPrefix: '',
      openCodeApiPrefixDetected: false,
      openCodeApiDetectionTimer: null,
      lastOpenCodeError: null,
      isOpenCodeReady: true,
      openCodeNotReadySince: 0,
      isExternalOpenCode: true,
      isShuttingDown: false,
      healthCheckInterval: null,
      expressApp: {},
      useWslForOpencode: false,
      resolvedWslBinary: null,
      resolvedWslOpencodePath: null,
      resolvedWslDistro: null,
    };
    const globalEventHub = {
      stop: vi.fn(() => calls.push('hub.stop')),
      start: vi.fn(() => calls.push('hub.start')),
    };

    globalThis.fetch = vi.fn(async (url) => {
      calls.push(`fetch:${new URL(url).pathname}`);
      if (String(url).endsWith('/global/health')) {
        return { ok: true, json: async () => ({ healthy: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const runtime = createRuntime({
      state,
      globalEventHub,
    });

    await runtime.refreshOpenCodeAfterConfigChange('custom provider saved');

    expect(globalEventHub.stop).toHaveBeenCalledTimes(1);
    expect(globalEventHub.start).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('hub.stop')).toBeLessThan(calls.indexOf('fetch:/global/health'));
    expect(calls.indexOf('hub.start')).toBeGreaterThan(calls.indexOf('fetch:/agent'));
  });
});
