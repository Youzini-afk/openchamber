import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyEdits,
  modify as modifyJsonc,
  parse as parseJsonc,
  printParseErrorCode,
} from 'jsonc-parser';
import {
  readOpenAgentConfig,
} from './openagent-config.js';
import {
  ensureSlimStarterConfig,
  readSlimConfig,
} from './slim-config.js';

const MODE_NATIVE = 'native';
const MODE_SLIM = 'slim';
const MODE_OMO = 'omo';
const MODE_CONFLICT = 'conflict';

const SLIM_PLUGIN_ENTRY = 'oh-my-opencode-slim';
const OMO_PLUGIN_ENTRY = 'oh-my-openagent';
const OMO_CACHE_PACKAGE = 'oh-my-opencode';
const SLIM_CACHE_PACKAGE = 'oh-my-opencode-slim';

const JSONC_FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
};

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOpenCodeConfigDir() {
  const envConfigDir = normalizeString(process.env.OPENCODE_CONFIG_DIR);
  if (envConfigDir) return path.resolve(envConfigDir);
  return path.join(os.homedir(), '.config', 'opencode');
}

function getOpenCodeCacheDir() {
  const envCacheDir = normalizeString(process.env.OPENCODE_CACHE_DIR);
  if (envCacheDir) return path.resolve(envCacheDir);
  if (process.platform === 'win32') {
    const localAppData = normalizeString(process.env.LOCALAPPDATA);
    if (localAppData) return path.join(localAppData, 'opencode');
  }
  const xdgCacheHome = normalizeString(process.env.XDG_CACHE_HOME);
  if (xdgCacheHome) return path.join(xdgCacheHome, 'opencode');
  return path.join(os.homedir(), '.cache', 'opencode');
}

function getUserOpenCodeConfigCandidates() {
  const configDir = getOpenCodeConfigDir();
  return [
    path.join(configDir, 'config.json'),
    path.join(configDir, 'opencode.jsonc'),
    path.join(configDir, 'opencode.json'),
  ];
}

function getProjectOpenCodeConfigCandidates(directory) {
  if (!directory) return [];
  return [
    path.join(directory, '.opencode', 'opencode.jsonc'),
    path.join(directory, '.opencode', 'opencode.json'),
    path.join(directory, 'opencode.jsonc'),
    path.join(directory, 'opencode.json'),
  ];
}

function getUserTuiConfigCandidates() {
  const configDir = getOpenCodeConfigDir();
  return [
    path.join(configDir, 'tui.jsonc'),
    path.join(configDir, 'tui.json'),
  ];
}

function getPrimaryUserOpenCodeConfigPath() {
  const candidates = getUserOpenCodeConfigCandidates();
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function getPrimaryUserTuiConfigPath() {
  const candidates = getUserTuiConfigCandidates();
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function parseJsoncObject(content, filePath) {
  const errors = [];
  const parsed = parseJsonc(content.replace(/^\uFEFF/, ''), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const message = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ');
    throw new SyntaxError(`Failed to parse ${filePath}: ${message}`);
  }
  return isPlainObject(parsed) ? parsed : {};
}

function readJsoncFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return {};
  return parseJsoncObject(content, filePath);
}

function getFileMtimeMs(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.statSync(filePath).mtimeMs;
}

function writeJsoncContent(filePath, content) {
  parseJsoncObject(content, filePath);
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.openchamber.backup`);
    } catch {
      // Backup failure should not block the requested config change.
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function updateJsoncRawProperty(content, key, value) {
  const edits = modifyJsonc(content, [key], value, {
    formattingOptions: JSONC_FORMATTING_OPTIONS,
  });
  return applyEdits(content, edits);
}

function getPluginSpec(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return '';
}

function getPluginBasename(spec) {
  const normalized = normalizeString(spec).replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function isSlimSpec(spec) {
  const basename = getPluginBasename(spec);
  return basename === SLIM_PLUGIN_ENTRY || basename.startsWith(`${SLIM_PLUGIN_ENTRY}@`);
}

function isOmoSpec(spec) {
  const basename = getPluginBasename(spec);
  return (
    basename === OMO_PLUGIN_ENTRY ||
    basename.startsWith(`${OMO_PLUGIN_ENTRY}@`) ||
    basename === OMO_CACHE_PACKAGE ||
    basename.startsWith(`${OMO_CACHE_PACKAGE}@`)
  );
}

function getSpecMode(spec) {
  if (isSlimSpec(spec)) return MODE_SLIM;
  if (isOmoSpec(spec)) return MODE_OMO;
  return null;
}

function getPluginArray(config, key) {
  return Array.isArray(config?.[key]) ? config[key] : [];
}

function getPreferredPluginArrayKey(config) {
  if (Array.isArray(config?.plugin)) return 'plugin';
  if (Array.isArray(config?.plugins)) return 'plugins';
  return 'plugin';
}

function scanConfigPlugins(filePath, scope, surface = 'opencode') {
  if (!fs.existsSync(filePath)) return [];
  const result = [];
  try {
    const config = readJsoncFile(filePath);
    for (const key of ['plugin', 'plugins']) {
      const entries = getPluginArray(config, key);
      entries.forEach((entry, index) => {
        const spec = getPluginSpec(entry);
        const mode = getSpecMode(spec);
        if (mode) {
          result.push({ path: filePath, key, index, entry: spec, mode, scope, surface });
        }
      });
    }
  } catch {
    // The dedicated config routes surface malformed files.
  }
  return result;
}

function resolveMode(entries) {
  const hasSlim = entries.some((entry) => entry.mode === MODE_SLIM);
  const hasOmo = entries.some((entry) => entry.mode === MODE_OMO);
  if (hasSlim && hasOmo) return MODE_CONFLICT;
  if (hasSlim) return MODE_SLIM;
  if (hasOmo) return MODE_OMO;
  return MODE_NATIVE;
}

function getConfigScan(directory) {
  const userPaths = getUserOpenCodeConfigCandidates();
  const projectPaths = getProjectOpenCodeConfigCandidates(directory);
  const tuiPaths = getUserTuiConfigCandidates();
  const userEntries = userPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'user', 'opencode'));
  const projectEntries = projectPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'project', 'opencode'));
  const tuiEntries = tuiPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'user', 'tui'));
  const allEntries = [...userEntries, ...projectEntries, ...tuiEntries];
  const configPaths = Array.from(new Set([
    ...userPaths.filter((filePath) => fs.existsSync(filePath)),
    ...projectPaths.filter((filePath) => fs.existsSync(filePath)),
    getPrimaryUserOpenCodeConfigPath(),
  ]));
  const tuiConfigPath = getPrimaryUserTuiConfigPath();
  const mtimeMsByPath = {};
  for (const filePath of Array.from(new Set([...configPaths, tuiConfigPath ? tuiConfigPath : null].filter(Boolean)))) {
    mtimeMsByPath[filePath] = getFileMtimeMs(filePath);
  }
  return {
    userPaths,
    projectPaths,
    tuiPaths,
    userEntries,
    projectEntries,
    tuiEntries,
    allEntries,
    configPaths,
    tuiConfigPath,
    mtimeMsByPath,
  };
}

function getModeInfo(directory) {
  const scan = getConfigScan(directory);
  const userMode = resolveMode(scan.userEntries);
  const projectMode = scan.projectEntries.length > 0 ? resolveMode(scan.projectEntries) : null;
  const allMode = resolveMode([...scan.userEntries, ...scan.projectEntries]);
  const effective = allMode === MODE_CONFLICT ? MODE_CONFLICT : (projectMode && projectMode !== MODE_NATIVE ? projectMode : userMode);
  const conflicts = [];
  if (allMode === MODE_CONFLICT) {
    conflicts.push('OpenCode config contains both Slim and Oh My OpenAgent entries.');
  }
  if (scan.tuiEntries.some((entry) => entry.mode === MODE_SLIM) && effective !== MODE_SLIM) {
    conflicts.push('TUI config still contains oh-my-opencode-slim while Slim mode is not active.');
  }
  return {
    effective,
    user: userMode,
    project: projectMode,
    conflicts,
    configPaths: scan.configPaths,
    tuiConfigPath: scan.tuiConfigPath,
    mtimeMsByPath: scan.mtimeMsByPath,
  };
}

function createConfigModifiedError() {
  const error = new Error('Config was modified outside OpenChamber. Reload before saving again.');
  error.code = 'CONFIG_MODIFIED';
  return error;
}

function hasMtimeMismatch(filePath, expectedMtimeMs) {
  if (expectedMtimeMs == null) return false;
  const currentMtimeMs = getFileMtimeMs(filePath);
  if (currentMtimeMs == null) return true;
  return Math.abs(currentMtimeMs - expectedMtimeMs) > 1;
}

function shouldCheckMtime(filePath, expectedMtimeMsByPath) {
  return isPlainObject(expectedMtimeMsByPath) && Object.prototype.hasOwnProperty.call(expectedMtimeMsByPath, filePath);
}

function assertNoMtimeMismatches(filePaths, expectedMtimeMsByPath) {
  for (const filePath of filePaths) {
    if (shouldCheckMtime(filePath, expectedMtimeMsByPath) && hasMtimeMismatch(filePath, expectedMtimeMsByPath[filePath])) {
      throw createConfigModifiedError();
    }
  }
}

function removeKnownOrchestrationEntries(entries) {
  return entries.filter((entry) => {
    const mode = getSpecMode(getPluginSpec(entry));
    return mode !== MODE_SLIM && mode !== MODE_OMO;
  });
}

function updateConfigPluginEntries(filePath, desiredMode, { allowAdd = false, surface = 'opencode' } = {}) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '{\n}\n';
  if (!content.trim()) content = '{\n}\n';
  const config = parseJsoncObject(content, filePath);
  const preferredKey = getPreferredPluginArrayKey(config);
  const keys = Array.from(new Set([preferredKey, 'plugin', 'plugins']));
  let nextContent = content;
  let changed = false;

  for (const key of keys) {
    const existing = getPluginArray(config, key);
    if (existing.length === 0 && key !== preferredKey) continue;
    const filtered = removeKnownOrchestrationEntries(existing);
    let nextEntries = filtered;
    if (allowAdd && key === preferredKey) {
      if (surface === 'tui') {
        if (desiredMode === MODE_SLIM) nextEntries = [...filtered, SLIM_PLUGIN_ENTRY];
      } else if (desiredMode === MODE_SLIM) {
        nextEntries = [...filtered, SLIM_PLUGIN_ENTRY];
      } else if (desiredMode === MODE_OMO) {
        nextEntries = [...filtered, OMO_PLUGIN_ENTRY];
      }
    }
    const equal = existing.length === nextEntries.length && existing.every((entry, index) => entry === nextEntries[index]);
    if (equal && Array.isArray(config?.[key])) continue;
    nextContent = updateJsoncRawProperty(nextContent, key, nextEntries.length > 0 ? nextEntries : undefined);
    changed = true;
  }

  if (changed || (allowAdd && !fs.existsSync(filePath))) {
    writeJsoncContent(filePath, nextContent);
  }
  return changed;
}

function getPathsWithKnownEntries(paths) {
  return paths.filter((filePath) => scanConfigPlugins(filePath, 'unknown').length > 0);
}

function setAgentOrchestrationMode(input = {}) {
  const directory = normalizeString(input.directory);
  const mode = normalizeString(input.mode);
  if (![MODE_NATIVE, MODE_SLIM, MODE_OMO].includes(mode)) {
    const error = new Error('Invalid agent orchestration mode.');
    error.code = 'INVALID_MODE';
    throw error;
  }

  const userTarget = getPrimaryUserOpenCodeConfigPath();
  const tuiTarget = getPrimaryUserTuiConfigPath();
  const existingPathsToClean = Array.from(new Set([
    ...getPathsWithKnownEntries(getUserOpenCodeConfigCandidates()),
    ...getPathsWithKnownEntries(getProjectOpenCodeConfigCandidates(directory)),
  ]));
  const existingTuiPathsToClean = Array.from(new Set(getPathsWithKnownEntries(getUserTuiConfigCandidates())));
  const pathsToWrite = Array.from(new Set([
    ...existingPathsToClean,
    ...(mode === MODE_NATIVE ? [] : [userTarget]),
    ...existingTuiPathsToClean,
    ...(mode === MODE_SLIM ? [tuiTarget] : []),
  ]));

  assertNoMtimeMismatches(pathsToWrite, input.expectedMtimeMsByPath);

  for (const filePath of existingPathsToClean) {
    updateConfigPluginEntries(filePath, MODE_NATIVE, { allowAdd: false, surface: 'opencode' });
  }
  if (mode !== MODE_NATIVE) {
    updateConfigPluginEntries(userTarget, mode, { allowAdd: true, surface: 'opencode' });
  }

  for (const filePath of existingTuiPathsToClean) {
    updateConfigPluginEntries(filePath, MODE_NATIVE, { allowAdd: false, surface: 'tui' });
  }
  if (mode === MODE_SLIM) {
    updateConfigPluginEntries(tuiTarget, MODE_SLIM, { allowAdd: true, surface: 'tui' });
  }

  return readAgentOrchestrationConfig({ directory });
}

function getPackageCachePath(packageName) {
  return path.join(getOpenCodeCacheDir(), 'node_modules', packageName);
}

function readPackageJsonVersion(packagePath) {
  try {
    const packageJsonPath = path.join(packagePath, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function getPackageStatus(plugin) {
  const packageName = plugin === MODE_OMO ? OMO_CACHE_PACKAGE : SLIM_CACHE_PACKAGE;
  const cachePath = getPackageCachePath(packageName);
  const installed = fs.existsSync(cachePath);
  return {
    packageName,
    entry: plugin === MODE_OMO ? OMO_PLUGIN_ENTRY : SLIM_PLUGIN_ENTRY,
    installed,
    version: installed ? readPackageJsonVersion(cachePath) : null,
    cachePath,
  };
}

function resolvePackageActionPlugin(value) {
  const normalized = normalizeString(value);
  if (normalized === 'omo') return MODE_OMO;
  if (normalized === 'slim') return MODE_SLIM;
  const error = new Error('Invalid plugin package target.');
  error.code = 'INVALID_PLUGIN';
  throw error;
}

function ensureInside(parent, child) {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return childResolved;
  }
  const error = new Error('Refusing to modify a path outside the OpenCode cache.');
  error.code = 'PATH_ESCAPE';
  throw error;
}

function clearPackageCache(plugin) {
  const packageName = plugin === MODE_OMO ? OMO_CACHE_PACKAGE : SLIM_CACHE_PACKAGE;
  const cacheRoot = path.join(getOpenCodeCacheDir(), 'node_modules');
  const packagePath = ensureInside(cacheRoot, path.join(cacheRoot, packageName));
  fs.rmSync(packagePath, { recursive: true, force: true });
  return packagePath;
}

function getConfigFilePathForPlugin(plugin) {
  const configDir = getOpenCodeConfigDir();
  if (plugin === MODE_SLIM) {
    const jsonc = path.join(configDir, 'oh-my-opencode-slim.jsonc');
    const json = path.join(configDir, 'oh-my-opencode-slim.json');
    return fs.existsSync(jsonc) ? jsonc : json;
  }
  const canonicalJsonc = path.join(configDir, 'oh-my-openagent.jsonc');
  const canonicalJson = path.join(configDir, 'oh-my-openagent.json');
  const legacyJsonc = path.join(configDir, 'oh-my-opencode.jsonc');
  const legacyJson = path.join(configDir, 'oh-my-opencode.json');
  return [canonicalJsonc, canonicalJson, legacyJsonc, legacyJson].find((candidate) => fs.existsSync(candidate)) ?? canonicalJsonc;
}

function ensureOmoStarterConfig() {
  const targetPath = getConfigFilePathForPlugin(MODE_OMO);
  if (fs.existsSync(targetPath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, '{\n}\n', 'utf8');
}

function deleteUserConfigForPlugin(plugin) {
  const targetPath = getConfigFilePathForPlugin(plugin);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
  return targetPath;
}

function runPackageAction(input = {}) {
  const directory = normalizeString(input.directory);
  const plugin = resolvePackageActionPlugin(input.plugin);
  const action = normalizeString(input.action);
  if (!['install', 'update', 'uninstall'].includes(action)) {
    const error = new Error('Invalid package action.');
    error.code = 'INVALID_ACTION';
    throw error;
  }

  let clearedCachePath = null;
  let deletedConfigPath = null;

  if (action === 'install') {
    if (plugin === MODE_SLIM) ensureSlimStarterConfig();
    if (plugin === MODE_OMO) ensureOmoStarterConfig();
    setAgentOrchestrationMode({ directory, mode: plugin });
  } else if (action === 'update') {
    clearedCachePath = clearPackageCache(plugin);
  } else if (action === 'uninstall') {
    setAgentOrchestrationMode({ directory, mode: MODE_NATIVE });
    if (input.deleteConfig === true) {
      deletedConfigPath = deleteUserConfigForPlugin(plugin);
    }
    if (input.clearCache === true) {
      clearedCachePath = clearPackageCache(plugin);
    }
  }

  return {
    success: true,
    action,
    plugin,
    clearedCachePath,
    deletedConfigPath,
    config: readAgentOrchestrationConfig({ directory }),
  };
}

function readAgentOrchestrationConfig(options = {}) {
  const directory = normalizeString(options.directory);
  return {
    mode: getModeInfo(directory),
    packages: {
      slim: getPackageStatus(MODE_SLIM),
      omo: getPackageStatus(MODE_OMO),
    },
    omo: readOpenAgentConfig({ directory }),
    slim: readSlimConfig({ directory }),
  };
}

export {
  MODE_NATIVE,
  MODE_SLIM,
  MODE_OMO,
  MODE_CONFLICT,
  readAgentOrchestrationConfig,
  setAgentOrchestrationMode,
  runPackageAction,
};
