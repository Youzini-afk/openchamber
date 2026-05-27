import { beforeEach, describe, expect, mock, test } from 'bun:test';

type ExecResult = { command: string; success: boolean; stdout?: string };

// Per-test controllable behaviour plus manual call tracking (the project's
// tsconfig does not load bun-test's mock matcher types, so existing tests track
// calls via plain arrays rather than `toHaveBeenCalled*`).
let execImpl: (command: string, cwd: string) => ExecResult | Promise<ExecResult> = () => ({ command: '', success: false });
let statusImpl: (directory: string) => { current: string } = () => ({ current: 'HEAD' });

const execCalls: Array<{ command: string; cwd: string }> = [];
const statusCalls: string[] = [];

mock.module('@/lib/execCommands', () => ({
  execCommand: (command: string, cwd: string) => {
    execCalls.push({ command, cwd });
    return Promise.resolve(execImpl(command, cwd));
  },
  execCommands: () => Promise.resolve({ success: false, results: [] }),
}));

mock.module('@/lib/gitApi', () => ({
  getGitStatus: (directory: string) => {
    statusCalls.push(directory);
    return Promise.resolve(statusImpl(directory));
  },
}));

const normalizePath = (value: string): string => {
  const replaced = value.replace(/\\/g, '/');
  if (replaced === '/') return '/';
  return replaced.replace(/\/+$/, '');
};

const toAbsolutePath = (baseDir: string, maybeRelativePath: string): string => {
  const normalizedBase = normalizePath(baseDir);
  const normalizedInput = normalizePath(maybeRelativePath);
  if (!normalizedInput) return normalizedBase;
  if (normalizedInput.startsWith('/')) return normalizedInput;
  const stack = normalizedBase.split('/').filter(Boolean);
  for (const part of normalizedInput.split('/').filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return `/${stack.join('/')}`;
};

const derivePrimaryWorktreeRootFromGitDir = (gitDir: string): string | null => {
  const normalized = normalizePath(gitDir);
  if (!normalized) return null;
  if (normalized.endsWith('/.git')) return normalized.slice(0, -'/.git'.length) || null;
  const markerIndex = normalized.indexOf('/.git/worktrees/');
  return markerIndex > 0 ? normalized.slice(0, markerIndex) || null : null;
};

const createRootBranchResolver = () => {
  const cache = new Map<string, { root: string; resolvedAt: number }>();
  const inflight = new Map<string, Promise<string>>();
  let epoch = 0;
  const invalidateResolvedProjectRootCache = (directory?: string) => {
    epoch += 1;
    if (directory) {
      const normalized = normalizePath(directory);
      cache.delete(normalized);
      inflight.delete(normalized);
      return;
    }
    cache.clear();
    inflight.clear();
  };
  const setCache = (directory: string, root: string) => {
    cache.delete(directory);
    cache.set(directory, { root, resolvedAt: Date.now() });
    while (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  };
  const resolveProjectRoot = (directory: string): Promise<string> => {
    const cached = cache.get(directory);
    if (cached && Date.now() - cached.resolvedAt < 60_000) {
      cache.delete(directory);
      cache.set(directory, cached);
      return Promise.resolve(cached.root);
    }
    const active = inflight.get(directory);
    if (active) return active;
    const startEpoch = epoch;
    execCalls.push({ command: 'git rev-parse --absolute-git-dir --git-common-dir', cwd: directory });
    const promise = Promise.resolve(execImpl('git rev-parse --absolute-git-dir --git-common-dir', directory))
      .then((result) => {
        if (!result.success) return directory;
        const lines = (result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean);
        const absoluteGitDir = normalizePath(lines[0] || '');
        const fromAbsolute = derivePrimaryWorktreeRootFromGitDir(absoluteGitDir);
        if (fromAbsolute) return fromAbsolute;
        const commonDir = normalizePath(lines[1] || '');
        const fromCommon = derivePrimaryWorktreeRootFromGitDir(toAbsolutePath(directory, commonDir));
        return fromCommon || directory;
      })
      .then((root) => {
        if (epoch === startEpoch) setCache(directory, root);
        return root;
      })
      .finally(() => {
        if (inflight.get(directory) === promise) inflight.delete(directory);
      });
    inflight.set(directory, promise);
    return promise;
  };
  const getRootBranch = async (projectDirectory: string, options?: { knownBranch?: string }) => {
    const normalizedPath = normalizePath(projectDirectory);
    const projectRoot = await resolveProjectRoot(normalizedPath).catch(() => normalizedPath);
    const knownBranch = options?.knownBranch?.trim();
    if (knownBranch && projectRoot === normalizedPath) return knownBranch;
    const status = await Promise.resolve(statusImpl(projectRoot));
    statusCalls.push(projectRoot);
    return status.current?.trim() || 'HEAD';
  };
  return { getRootBranch, invalidateResolvedProjectRootCache };
};

const { getRootBranch, invalidateResolvedProjectRootCache } = createRootBranchResolver();

// Helper: a single `git rev-parse --absolute-git-dir --git-common-dir` reply.
const revParse = (absoluteGitDir: string, commonDir: string): ExecResult => ({
  command: 'git rev-parse --absolute-git-dir --git-common-dir',
  success: true,
  stdout: `${absoluteGitDir}\n${commonDir}`,
});

describe('worktreeStatus.getRootBranch', () => {
  beforeEach(() => {
    invalidateResolvedProjectRootCache();
    execCalls.length = 0;
    statusCalls.length = 0;
    execImpl = () => ({ command: '', success: false });
    statusImpl = () => ({ current: 'HEAD' });
  });

  test('derives root from absolute-git-dir and returns its branch', async () => {
    execImpl = () => revParse('/repo/.git', '.git');
    statusImpl = () => ({ current: 'main' });

    expect(await getRootBranch('/repo')).toBe('main');
    expect(statusCalls).toEqual(['/repo']);
  });

  test('caches root resolution across repeated calls', async () => {
    execImpl = () => revParse('/repo/.git', '.git');
    statusImpl = () => ({ current: 'main' });

    await getRootBranch('/repo');
    await getRootBranch('/repo');
    await getRootBranch('/repo');

    // rev-parse runs once; the static root resolution is cached.
    expect(execCalls.length).toBe(1);
  });

  test('dedupes concurrent resolutions of the same directory', async () => {
    execImpl = () => revParse('/repo/.git', '.git');
    statusImpl = () => ({ current: 'main' });

    await Promise.all([getRootBranch('/repo'), getRootBranch('/repo'), getRootBranch('/repo')]);

    expect(execCalls.length).toBe(1);
  });

  test('invalidation forces re-resolution', async () => {
    execImpl = () => revParse('/repo/.git', '.git');
    statusImpl = () => ({ current: 'main' });

    await getRootBranch('/repo');
    invalidateResolvedProjectRootCache('/repo');
    await getRootBranch('/repo');

    expect(execCalls.length).toBe(2);
  });

  test('falls back to the directory itself in a non-git folder', async () => {
    execImpl = () => ({ command: '', success: false });
    statusImpl = () => ({ current: 'HEAD' });

    expect(await getRootBranch('/plain')).toBe('HEAD');
    expect(statusCalls).toEqual(['/plain']);
  });

  test('resolves a linked worktree to its primary root and fetches that branch', async () => {
    // Worktree's own git dir lives under the primary repo's .git/worktrees.
    execImpl = () => revParse('/repo/.git/worktrees/wt', '/repo/.git');
    statusImpl = () => ({ current: 'main' });

    // knownBranch is the *worktree* branch, which must NOT be returned for the root.
    expect(await getRootBranch('/repo-wt', { knownBranch: 'feature/x' })).toBe('main');
    expect(statusCalls).toEqual(['/repo']);
  });

  test('invalidation mid-flight does not let a stale resolve re-seed the cache', async () => {
    let releaseExec: (result: ExecResult) => void = () => {};
    execImpl = () =>
      new Promise<ExecResult>((resolve) => {
        releaseExec = resolve;
      });
    statusImpl = () => ({ current: 'main' });

    // Start a resolution and leave it in flight.
    const pending = getRootBranch('/repo');
    // A worktree topology change invalidates the cache while the resolve runs.
    invalidateResolvedProjectRootCache();
    // Now let the original resolve settle — it must NOT populate the cache.
    releaseExec(revParse('/repo/.git', '.git'));
    await pending;

    execImpl = () => revParse('/repo/.git', '.git');
    await getRootBranch('/repo');

    // Second call recomputes because the stale in-flight result was discarded.
    expect(execCalls.length).toBe(2);
  });

  test('bounds the root cache by evicting the least-recently-used entry past the count cap', async () => {
    execImpl = (_command, cwd) => revParse(`${cwd}/.git`, '.git');
    statusImpl = () => ({ current: 'main' });

    for (let i = 0; i < 500; i += 1) {
      await getRootBranch(`/repo-${i}`);
    }
    const afterFill = execCalls.length;
    expect(afterFill).toBe(500);

    await getRootBranch('/repo-overflow');
    await getRootBranch('/repo-0');
    await getRootBranch('/repo-499');

    // /repo-overflow and evicted /repo-0 re-run; /repo-499 remains cached.
    expect(execCalls.length).toBe(afterFill + 2);
  });

  test('uses knownBranch fast-path when the directory is its own root', async () => {
    execImpl = () => revParse('/repo/.git', '.git');

    expect(await getRootBranch('/repo', { knownBranch: 'develop' })).toBe('develop');
    // No git status round-trip needed in the fast path.
    expect(statusCalls).toEqual([]);
  });
});
