import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createServerUtilsRuntime } from './server-utils-runtime.js';

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

const createRuntime = (loginShellPath, overrides = {}) => createServerUtilsRuntime({
  fs: {},
  os,
  path,
  process,
  openCodeReadyGraceMs: 0,
  longRequestTimeoutMs: 0,
  getRuntime: () => ({}),
  getOpenCodeAuthHeaders: () => ({}),
  buildOpenCodeUrl: (route) => route,
  ensureOpenCodeApiPrefix: () => {},
  getUiNotificationClients: () => new Set(),
  getOpenCodePort: () => null,
  setOpenCodePortState: () => {},
  syncToHmrState: () => {},
  markOpenCodeNotReady: () => {},
  setOpenCodeNotReadySince: () => {},
  clearLastOpenCodeError: () => {},
  getLoginShellPath: () => loginShellPath,
  augmentPathWithBundledRipgrep: () => ({ added: false, binDir: null }),
  ...overrides,
});

describe('server utils runtime', () => {
  it('prefers shell PATH for managed OpenCode before appending process-only entries', () => {
    const home = os.homedir();
    const currentPath = [
      path.join(home, '.opencode', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);
    process.env.PATH = currentPath;

    const runtime = createRuntime([
      path.join(home, '.opencode', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
    ].join(path.delimiter));

    expect(runtime.buildManagedOpenCodePath()).toBe([
      path.join(home, '.opencode', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
      path.join(home, 'Library', 'pnpm'),
    ].join(path.delimiter));
  });

  it('uses login shell PATH for managed OpenCode when process PATH is minimal', () => {
    const home = os.homedir();
    const loginShellPath = [
      path.join(home, '.opencode', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);
    process.env.PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter);

    const runtime = createRuntime(loginShellPath);

    // Should prefer login shell PATH but merge in any process entries not already present.
    expect(runtime.buildManagedOpenCodePath()).toBe([
      path.join(home, '.opencode', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/bin',
    ].join(path.delimiter));
  });

  it('prepends bundled ripgrep for managed OpenCode processes', () => {
    const bundledRgPath = path.join(os.tmpdir(), 'openchamber-rg-bin');
    process.env.PATH = ['/usr/local/bin', '/usr/bin'].join(path.delimiter);
    const runtime = createRuntime('/usr/bin', {
      augmentPathWithBundledRipgrep: ({ env }) => {
        env.PATH = [bundledRgPath, env.PATH].filter(Boolean).join(path.delimiter);
        return { added: true, binDir: bundledRgPath };
      },
    });

    expect(runtime.buildManagedOpenCodePath().split(path.delimiter)[0]).toBe(bundledRgPath);
  });

  it('preserves user-configured process PATH order before appending shell-only entries', () => {
    const home = os.homedir();
    process.env.PATH = [
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);

    const runtime = createRuntime([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      path.join(home, '.cargo', 'bin'),
      '/usr/bin',
    ].join(path.delimiter));

    expect(runtime.buildAugmentedPath()).toBe([
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
    ].join(path.delimiter));
  });

  it('prefers login shell PATH when current process PATH is minimal', () => {
    const home = os.homedir();
    process.env.PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter);

    const runtime = createRuntime([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter));

    expect(runtime.buildAugmentedPath()).toBe([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/bin',
    ].join(path.delimiter));
  });

  it('prepends bundled ripgrep for terminal PATHs', () => {
    const bundledRgPath = path.join(os.tmpdir(), 'openchamber-rg-bin');
    process.env.PATH = ['/usr/local/bin', '/usr/bin'].join(path.delimiter);
    const runtime = createRuntime('/usr/bin', {
      augmentPathWithBundledRipgrep: ({ env }) => {
        env.PATH = [bundledRgPath, env.PATH].filter(Boolean).join(path.delimiter);
        return { added: true, binDir: bundledRgPath };
      },
    });

    expect(runtime.buildAugmentedPath().split(path.delimiter)[0]).toBe(bundledRgPath);
  });
});
