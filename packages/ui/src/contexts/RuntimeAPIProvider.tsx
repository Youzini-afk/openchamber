import React, { type JSX, type ReactNode } from 'react';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import type { FilesAPI, RuntimeAPIs } from '@/lib/api/types';
import {
  approxStringBytes,
  evictContentLru,
  setContentBytes,
  touchContent as touchContentLru,
  removeContentBytes,
} from '@/sync/content-cache';

const makeCacheKey = (path: string, directory?: string): string =>
  JSON.stringify([directory ?? null, path]);

/** Wrap a FilesAPI with an in-memory LRU content cache. */
function withContentCache(files: FilesAPI): FilesAPI {
  const cache = new Map<string, { content: string; path: string; size?: number; mtimeMs?: number }>();

  const removeCacheEntry = (key: string) => {
    cache.delete(key);
    removeContentBytes(key);
  };

  const parseCacheKey = (key: string): [directory: string | null, path: string] | null => {
    try {
      const parsed = JSON.parse(key) as unknown;
      if (
        Array.isArray(parsed)
        && parsed.length === 2
        && (parsed[0] === null || typeof parsed[0] === 'string')
        && typeof parsed[1] === 'string'
      ) {
        return parsed as [string | null, string];
      }
    } catch {
      // Ignore legacy or corrupt keys.
    }
    return null;
  };

  const invalidatePath = (path: string) => {
    removeCacheEntry(makeCacheKey(path));
    for (const key of cache.keys()) {
      const parsed = parseCacheKey(key);
      if (parsed && parsed[1] === path) {
        removeCacheEntry(key);
      }
    }
  };

  const removeCacheEntriesByPrefix = (path: string) => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    for (const key of cache.keys()) {
      const parsed = parseCacheKey(key);
      if (parsed && (parsed[1] === path || parsed[1].startsWith(prefix))) {
        removeCacheEntry(key);
      }
    }
  };

  /** Whether cached metadata still matches the file on disk. */
  const statMatches = (
    cached: { size?: number; mtimeMs?: number },
    latest: { isFile: boolean; size: number; mtimeMs?: number },
  ): boolean => {
    if (!latest.isFile) return false;
    // If mtimeMs is available on both sides, it is the strongest signal.
    if (cached.mtimeMs !== undefined && latest.mtimeMs !== undefined) {
      return cached.mtimeMs === latest.mtimeMs && cached.size === latest.size;
    }
    return cached.size === latest.size;
  };

  const syncCacheEntry = (
    key: string,
    result: { content: string; path: string },
    stat?: { isFile: boolean; size: number; mtimeMs?: number } | null,
  ): { content: string; path: string } => {
    const bytes = approxStringBytes(result.content);
    cache.set(key, {
      ...result,
      size: stat?.isFile ? stat.size : undefined,
      mtimeMs: stat?.isFile ? stat.mtimeMs : undefined,
    });
    setContentBytes(key, bytes);

    const keep = new Set<string>();
    evictContentLru(keep, (evictPath) => {
      cache.delete(evictPath);
    });

    return result;
  };

  const readFreshFile = async (
    path: string,
    options?: Parameters<NonNullable<FilesAPI['readFile']>>[1],
    cacheKey?: string,
  ): Promise<{ content: string; path: string }> => {
    const key = cacheKey ?? makeCacheKey(path, options?.directory);

    // stat → read → stat to avoid TOCTOU:
    // if the file changes between read and either stat, metadata won't match and we retry.
    const statBefore = await files.statFile?.(path, options).catch(() => null);

    const result = await files.readFile!(path, options);

    const statAfter = await files.statFile?.(path, options).catch(() => null);

    // If both stats are available and agree, the read was atomic with respect to file changes.
    if (statBefore && statAfter && statBefore.isFile && statAfter.isFile) {
      if (statBefore.size === statAfter.size && statBefore.mtimeMs === statAfter.mtimeMs) {
        return syncCacheEntry(key, result, statAfter);
      }
      // File changed during read — discard and re-read once.
      const retryStatBefore = await files.statFile?.(path, options).catch(() => null);
      const retry = await files.readFile!(path, options);
      const retryStat = await files.statFile?.(path, options).catch(() => null);
      // Accept retry only if file was stable across the read.
      if (retryStatBefore && retryStat && retryStatBefore.isFile && retryStat.isFile
        && retryStatBefore.size === retryStat.size && retryStatBefore.mtimeMs === retryStat.mtimeMs) {
        return syncCacheEntry(key, retry, retryStat);
      }
      // Best-effort: file was still changing, cache what we got. Next hit will re-validate.
      return syncCacheEntry(key, retry, retryStat);
    }

    return syncCacheEntry(key, result, statAfter ?? statBefore);
  };

  const cachedReadFile: FilesAPI['readFile'] = files.readFile
    ? async (path: string, options) => {
        if (options?.allowOutsideWorkspace) {
          return readFreshFile(path, options);
        }
        const key = makeCacheKey(path, options?.directory);
        const hit = cache.get(key);
        if (hit) {
          // Validate cached entry is still fresh
          if (files.statFile) {
            const latest = await files.statFile(path, options).catch(() => {
              removeCacheEntry(key);
              return null;
            });
            if (!latest || !statMatches(hit, latest)) {
              removeCacheEntry(key);
              return readFreshFile(path, options, key);
            }
          }
          touchContentLru(key);
          return { content: hit.content, path: hit.path };
        }

        return readFreshFile(path, options, key);
      }
    : undefined;

  // Invalidate cache on writes, deletes, renames
  const cachedWriteFile: FilesAPI['writeFile'] = files.writeFile
    ? async (path, content) => {
        invalidatePath(path);
        return files.writeFile!(path, content);
      }
    : undefined;

  const cachedDelete: FilesAPI['delete'] = files.delete
    ? async (path) => {
        removeCacheEntriesByPrefix(path);
        invalidatePath(path);
        return files.delete!(path);
      }
    : undefined;

  const cachedRename: FilesAPI['rename'] = files.rename
    ? async (oldPath, newPath) => {
        removeCacheEntriesByPrefix(oldPath);
        removeCacheEntriesByPrefix(newPath);
        invalidatePath(oldPath);
        invalidatePath(newPath);
        return files.rename!(oldPath, newPath);
      }
    : undefined;

  return {
    ...files,
    readFile: cachedReadFile,
    writeFile: cachedWriteFile,
    delete: cachedDelete,
    rename: cachedRename,
  };
}

export function RuntimeAPIProvider({ apis, children }: { apis: RuntimeAPIs; children: ReactNode }): JSX.Element {
  const cachedApis = React.useMemo<RuntimeAPIs>(
    () => ({
      ...apis,
      files: withContentCache(apis.files),
    }),
    [apis],
  );
  return <RuntimeAPIContext.Provider value={cachedApis}>{children}</RuntimeAPIContext.Provider>;
}
