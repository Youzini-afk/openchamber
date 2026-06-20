import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

import { WorkspacePathError, resolveWorkspacePath } from './path-safety.js';
import { WorkspacePayloadTooLargeError } from './filesystem.js';

const ZIP_DIRECTORY_MODE = 0o40755 << 16;

const safeDownloadName = (nameValue) => {
  const cleaned = String(nameValue || 'workspace')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'workspace';
};

const toZipPath = (...segments) => (
  segments
    .filter((segment) => typeof segment === 'string' && segment.length > 0)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
);

const addDirectoryEntry = (zip, entryPath) => {
  const normalized = toZipPath(entryPath);
  if (!normalized) return;
  const zipPath = normalized.endsWith('/') ? normalized : `${normalized}/`;
  zip.addFile(zipPath, Buffer.alloc(0), '', ZIP_DIRECTORY_MODE);
};

const createDirectoryZip = async (resolved, stat, config, dependencies = {}) => {
  const {
    fsPromises = fs.promises,
    pathModule = path,
    osModule = os,
  } = dependencies;

  const baseName = safeDownloadName(pathModule.basename(resolved.absolutePath) || 'workspace');
  const zip = new AdmZip();
  const limits = {
    maxBytes: Number.isFinite(config.maxDownloadBytes) ? config.maxDownloadBytes : 12 * 1024 * 1024 * 1024,
    maxFiles: Number.isFinite(config.maxDownloadFiles) ? config.maxDownloadFiles : 0,
  };
  const totals = {
    files: 0,
    bytes: 0,
  };

  const addDirectory = async (absolutePath, zipPath) => {
    addDirectoryEntry(zip, zipPath);

    const entries = await fsPromises.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const childAbsolutePath = pathModule.join(absolutePath, entry.name);
      const childZipPath = toZipPath(zipPath, entry.name);
      const childStat = await fsPromises.lstat(childAbsolutePath);

      if (childStat.isSymbolicLink()) {
        continue;
      }

      if (childStat.isDirectory()) {
        await addDirectory(childAbsolutePath, childZipPath);
        continue;
      }

      if (!childStat.isFile()) {
        continue;
      }

      totals.files += 1;
      totals.bytes += childStat.size;
      if (limits.maxFiles > 0 && totals.files > limits.maxFiles) {
        throw new WorkspacePayloadTooLargeError('Directory contains too many files to download');
      }
      if (totals.bytes > limits.maxBytes) {
        throw new WorkspacePayloadTooLargeError('Directory is too large to download');
      }

      zip.addFile(childZipPath, await fsPromises.readFile(childAbsolutePath));
    }
  };

  if (!stat.isDirectory()) {
    throw new WorkspacePathError('Path is not a file or directory');
  }

  await addDirectory(resolved.absolutePath, baseName);

  const tempDir = await fsPromises.mkdtemp(pathModule.join(osModule.tmpdir(), 'openchamber-download-'));
  const archivePath = pathModule.join(tempDir, `${baseName}.zip`);
  try {
    await new Promise((resolve, reject) => {
      zip.writeZip(archivePath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (error) {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    archivePath,
    tempDir,
    fileName: `${baseName}.zip`,
  };
};

export const resolveWorkspaceDownload = async (pathValue, config, dependencies = {}) => {
  const {
    fsPromises = fs.promises,
    pathModule = path,
  } = dependencies;

  const resolved = await resolveWorkspacePath(pathValue, {
    root: config.root,
    fsPromises,
    pathModule,
  });
  const stat = await fsPromises.stat(resolved.absolutePath);

  if (stat.isFile()) {
    return {
      type: 'file',
      filePath: resolved.absolutePath,
      fileName: pathModule.basename(resolved.absolutePath) || 'download',
    };
  }

  if (stat.isDirectory()) {
    return {
      type: 'archive',
      ...await createDirectoryZip(resolved, stat, config, dependencies),
    };
  }

  throw new WorkspacePathError('Path is not a file or directory');
};
