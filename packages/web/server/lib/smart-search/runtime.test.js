import { describe, expect, it, vi } from 'vitest';
import { createSmartSearchRuntime } from './runtime.js';

const pathModule = await import('path');

const createSpawn = (handlers) => vi.fn((bin, args) => {
  const listeners = {};
  const stdoutListeners = {};
  const stderrListeners = {};
  const child = {
    stdout: { on: (event, cb) => { stdoutListeners[event] = cb; } },
    stderr: { on: (event, cb) => { stderrListeners[event] = cb; } },
    on: (event, cb) => { listeners[event] = cb; },
    kill: vi.fn(),
  };
  queueMicrotask(() => {
    const response = handlers(args, bin);
    if (response.error) {
      listeners.error?.(response.error);
      return;
    }
    if (response.stdout) stdoutListeners.data?.(Buffer.from(response.stdout));
    if (response.stderr) stderrListeners.data?.(Buffer.from(response.stderr));
    listeners.close?.(response.code ?? 0, response.signal ?? null);
  });
  return child;
});

describe('Smart Search runtime', () => {
  it('loads masked config without returning secret values', async () => {
    const configFile = pathModule.join('tmp', 'smart-search', 'config.json');
    const fsPromises = {
      readFile: vi.fn(async () => JSON.stringify({ XAI_API_KEY: 'sk-1234567890', XAI_MODEL: 'grok-4-fast' })),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
    };
    const spawn = createSpawn((args) => {
      if (args[0] === 'config') return { stdout: JSON.stringify({ ok: true, config_file: configFile }) };
      return { stdout: 'smart-search 1.0.0' };
    });
    const runtime = createSmartSearchRuntime({ fsPromises, path: pathModule, spawn, env: {} });

    const config = await runtime.loadConfig();

    expect(config.values.XAI_API_KEY).toMatchObject({ isSet: true, secret: true, source: 'config_file', editable: true });
    expect(config.values.XAI_API_KEY.value).toBeUndefined();
    expect(config.values.XAI_API_KEY.maskedValue).toBe('sk-1*****7890');
    expect(config.values.XAI_MODEL.value).toBe('grok-4-fast');
  });

  it('uses explicit set/unset without disturbing omitted keys', async () => {
    const configFile = pathModule.join('tmp', 'smart-search', 'config.json');
    let file = { XAI_API_KEY: 'old-secret', XAI_MODEL: 'old-model', EXA_API_KEY: 'exa-secret' };
    const fsPromises = {
      readFile: vi.fn(async () => JSON.stringify(file)),
      mkdir: vi.fn(),
      writeFile: vi.fn(async (_file, content) => { file = JSON.parse(content); }),
      rename: vi.fn(),
    };
    const spawn = createSpawn(() => ({ stdout: JSON.stringify({ ok: true, config_file: configFile }) }));
    const runtime = createSmartSearchRuntime({ fsPromises, path: pathModule, spawn, env: {} });

    await runtime.patchConfig({ set: { XAI_MODEL: 'new-model' }, unset: ['EXA_API_KEY'] });

    expect(file).toEqual({ XAI_API_KEY: 'old-secret', XAI_MODEL: 'new-model' });
  });

  it('returns doctor JSON even when CLI exits non-zero', async () => {
    const spawn = createSpawn((args) => {
      if (args[0] === 'doctor') return { code: 2, stdout: JSON.stringify({ ok: false, error_type: 'config_error' }) };
      return { stdout: JSON.stringify({ ok: true, config_file: '/tmp/config.json' }) };
    });
    const runtime = createSmartSearchRuntime({
      fsPromises: { readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() },
      path: pathModule,
      spawn,
      env: {},
    });

    const doctor = await runtime.runDoctor();

    expect(doctor).toMatchObject({ ok: false, exitCode: 2, result: { ok: false, error_type: 'config_error' } });
  });
});
