import fs from 'fs';
import path from 'path';
import { ensureWorkspaceRoot } from './workspace-config.js';
import { resolveWorkspacePath } from './path-safety.js';

const resolveWorkspaceGitDirectory = async (relativePathValue, config, dependencies = {}) => {
  const {
    fsPromises = fs.promises,
    pathModule = path,
  } = dependencies;
  await ensureWorkspaceRoot(config, fsPromises);
  const resolved = await resolveWorkspacePath(relativePathValue, {
    root: config.root,
    fsPromises,
    pathModule,
  });
  const stat = await fsPromises.stat(resolved.absolutePath);
  if (!stat.isDirectory()) {
    const error = new Error('Git operations require a workspace directory');
    error.statusCode = 400;
    throw error;
  }
  return resolved.absolutePath;
};

const getGitLibraries = async () => import('../git/index.js');

export const getWorkspaceGitStatus = async (relativePathValue, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  if (!await git.isGitRepository(directory)) {
    return {
      isGitRepository: false,
      files: [],
      branch: null,
      current: '',
      tracking: null,
      ahead: 0,
      behind: 0,
      isClean: true,
    };
  }
  return {
    isGitRepository: true,
    ...await git.getStatus(directory, dependencies.options || {}),
  };
};

export const workspaceGitFetch = async (relativePathValue, payload, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.fetch(directory, payload || {});
};

export const workspaceGitPull = async (relativePathValue, payload, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.pull(directory, payload || {});
};

export const workspaceGitPush = async (relativePathValue, payload, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.push(directory, payload || {});
};

export const workspaceGitCheckout = async (relativePathValue, branch, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.checkoutBranch(directory, branch);
};

export const workspaceGitCommit = async (relativePathValue, payload, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  const message = String(payload?.message || '').trim();
  if (!message) {
    const error = new Error('message is required');
    error.statusCode = 400;
    throw error;
  }
  return git.commit(directory, message, {
    addAll: payload?.addAll === true,
    files: Array.isArray(payload?.files) ? payload.files : undefined,
  });
};

export const workspaceGitLog = async (relativePathValue, query, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.getLog(directory, query || {});
};

export const workspaceGitRemotes = async (relativePathValue, config, dependencies = {}) => {
  const directory = await resolveWorkspaceGitDirectory(relativePathValue, config, dependencies);
  const git = await getGitLibraries();
  return git.getRemotes(directory);
};

