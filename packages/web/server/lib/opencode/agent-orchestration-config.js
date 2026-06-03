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
  readSlimConfig,
} from './slim-config.js';
import {
  AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS,
  MODE_NATIVE,
  MODE_OMO,
  MODE_SLIM,
  getAgentOrchestrationProviderCandidate,
  getDefaultSpecForLegacyMode,
  getLegacyModeForProviderId,
  getProviderIdForLegacyMode,
  legacyModeUsesTui,
} from './agent-orchestration-providers.js';

const MODE_CONFLICT = 'conflict';

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

function getUserOpenCodeConfigCandidates() {
  const configDir = getOpenCodeConfigDir();
  return [
    path.join(configDir, 'opencode.jsonc'),
    path.join(configDir, 'opencode.json'),
  ];
}

function getLegacyUserOpenCodeConfigCandidates() {
  const configDir = getOpenCodeConfigDir();
  return [
    path.join(configDir, 'config.json'),
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
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.join(getOpenCodeConfigDir(), 'opencode.jsonc');
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
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    if (typeof stat.mtimeNs === 'bigint') {
      return Number(stat.mtimeNs);
    }
  } catch {
  }
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

function getPluginOptions(entry) {
  return Array.isArray(entry) && isPlainObject(entry[1]) ? entry[1] : undefined;
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
        const provider = getAgentOrchestrationProviderCandidate({ spec, options: getPluginOptions(entry) });
        if (provider) {
          result.push({ path: filePath, key, index, entry: spec, rawEntry: entry, mode: provider.legacyMode, providerId: provider.id, provider, scope, surface });
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

function getActiveProviderIds(entries) {
  return Array.from(new Set(entries.map((entry) => entry.providerId).filter(Boolean)));
}

function getConfigScan(directory) {
  const userPaths = getUserOpenCodeConfigCandidates();
  const legacyUserPaths = getLegacyUserOpenCodeConfigCandidates();
  const projectPaths = getProjectOpenCodeConfigCandidates(directory);
  const tuiPaths = getUserTuiConfigCandidates();
  const userEntries = userPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'user', 'opencode'));
  const legacyUserEntries = legacyUserPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'user', 'opencode-legacy'));
  const projectEntries = projectPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'project', 'opencode'));
  const tuiEntries = tuiPaths.flatMap((filePath) => scanConfigPlugins(filePath, 'user', 'tui'));
  const allEntries = [...userEntries, ...projectEntries, ...tuiEntries];
  const configPaths = Array.from(new Set([
    ...userPaths.filter((filePath) => fs.existsSync(filePath)),
    ...projectPaths.filter((filePath) => fs.existsSync(filePath)),
    getPrimaryUserOpenCodeConfigPath(),
  ]));
  const tuiConfigPath = getPrimaryUserTuiConfigPath();
  const mtimePaths = [
    ...userPaths,
    ...legacyUserPaths,
    ...projectPaths,
    ...tuiPaths,
    getPrimaryUserOpenCodeConfigPath(),
    tuiConfigPath,
  ];
  const mtimeMsByPath = {};
  for (const filePath of Array.from(new Set(mtimePaths.filter(Boolean)))) {
    mtimeMsByPath[filePath] = getFileMtimeMs(filePath);
  }
  return {
    userPaths,
    legacyUserPaths,
    projectPaths,
    tuiPaths,
    userEntries,
    legacyUserEntries,
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
  return getModeInfoFromScan(scan);
}

function getModeInfoFromScan(scan) {
  const userMode = resolveMode(scan.userEntries);
  const projectMode = scan.projectEntries.length > 0 ? resolveMode(scan.projectEntries) : null;
  const allMode = resolveMode([...scan.userEntries, ...scan.projectEntries]);
  const providerIds = getActiveProviderIds([...scan.userEntries, ...scan.projectEntries]);
  const effective = allMode === MODE_CONFLICT ? MODE_CONFLICT : (projectMode && projectMode !== MODE_NATIVE ? projectMode : userMode);
  const conflicts = [];
  if (allMode === MODE_CONFLICT || providerIds.length > 1) {
    conflicts.push('OpenCode config contains multiple agent orchestration provider entries.');
  }
  if (scan.tuiEntries.some((entry) => entry.mode === MODE_SLIM) && effective !== MODE_SLIM) {
    conflicts.push('TUI config still contains oh-my-opencode-slim while Slim mode is not active.');
  }
  if (scan.legacyUserEntries.length > 0) {
    conflicts.push('Legacy config.json contains agent orchestration plugin entries that OpenCode may ignore. Save the mode again to move them to opencode.jsonc.');
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

function getProviderStateForMode(mode) {
  if (mode === MODE_CONFLICT) return 'conflict';
  if (mode === MODE_NATIVE) return 'native';
  return 'active';
}

function getProviderInfo(mode, entries) {
  const providerIds = getActiveProviderIds(entries.filter((entry) => entry.surface !== 'tui'));
  const providerState = mode.effective === MODE_CONFLICT || providerIds.length > 1
    ? 'conflict'
    : providerIds.length === 1 ? 'active' : getProviderStateForMode(mode.effective);
  const activeProviderId = providerState === 'active'
    ? providerIds[0] ?? getProviderIdForLegacyMode(mode.effective)
    : null;
  const providersById = new Map();
  for (const descriptor of AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS) {
    providersById.set(descriptor.id, {
      id: descriptor.id,
      legacyMode: descriptor.legacyMode,
      title: descriptor.title,
      description: descriptor.description ?? null,
      active: activeProviderId === descriptor.id,
      installed: false,
      managementSurfaceId: descriptor.managementSurfaceId,
      expectedAgentName: descriptor.expectedAgentName ?? null,
      known: true,
      configurable: Boolean(descriptor.managementSurfaceId),
    });
  }
  for (const entry of entries.filter((item) => item.surface !== 'tui')) {
    if (!entry.providerId || !entry.provider) continue;
    providersById.set(entry.providerId, {
      id: entry.provider.id,
      legacyMode: entry.provider.legacyMode,
      title: entry.provider.title,
      description: entry.provider.description ?? null,
      active: activeProviderId === entry.provider.id,
      installed: true,
      managementSurfaceId: entry.provider.managementSurfaceId,
      expectedAgentName: entry.provider.expectedAgentName ?? null,
      known: entry.provider.known === true,
      configurable: entry.provider.configurable === true,
    });
  }
  const providers = Array.from(providersById.values()).map((provider) => {
    const matchingEntries = entries.filter((entry) => entry.providerId === provider.id);
    return {
      ...provider,
      active: activeProviderId === provider.id,
      installed: matchingEntries.length > 0,
    };
  });
  return {
    activeProviderId,
    providerState,
    providers,
    diagnostics: {
      conflicts: mode.conflicts,
      configPaths: mode.configPaths,
      tuiConfigPath: mode.tuiConfigPath,
      mtimeMsByPath: mode.mtimeMsByPath,
    },
  };
}

function createConfigModifiedError() {
  const error = new Error('Config was modified outside OpenChamber. Reload before saving again.');
  error.code = 'CONFIG_MODIFIED';
  return error;
}

function hasMtimeMismatch(filePath, expectedMtimeMs) {
  const currentMtimeMs = getFileMtimeMs(filePath);
  if (expectedMtimeMs == null) return currentMtimeMs != null;
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

function assertNoExpectedMtimeMismatches(expectedMtimeMsByPath) {
  if (!isPlainObject(expectedMtimeMsByPath)) return;
  assertNoMtimeMismatches(Object.keys(expectedMtimeMsByPath), expectedMtimeMsByPath);
}

function removeKnownOrchestrationEntries(entries) {
  return entries.filter((entry) => {
    const provider = getAgentOrchestrationProviderCandidate({ spec: getPluginSpec(entry), options: getPluginOptions(entry) });
    return provider == null;
  });
}

function updateConfigPluginEntries(filePath, desiredMode, { allowAdd = false, surface = 'opencode', addEntry } = {}) {
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
      const defaultEntry = addEntry ?? getDefaultSpecForLegacyMode(desiredMode, { surface });
      if (defaultEntry) {
        nextEntries = [...filtered, defaultEntry];
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
    ...getPathsWithKnownEntries(getLegacyUserOpenCodeConfigCandidates()),
    ...getPathsWithKnownEntries(getProjectOpenCodeConfigCandidates(directory)),
  ]));
  const existingTuiPathsToClean = Array.from(new Set(getPathsWithKnownEntries(getUserTuiConfigCandidates())));
  const pathsToWrite = Array.from(new Set([
    ...existingPathsToClean,
    ...(mode === MODE_NATIVE ? [] : [userTarget]),
    ...existingTuiPathsToClean,
    ...(legacyModeUsesTui(mode) ? [tuiTarget] : []),
  ]));

  assertNoExpectedMtimeMismatches(input.expectedMtimeMsByPath);
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
  if (legacyModeUsesTui(mode)) {
    updateConfigPluginEntries(tuiTarget, mode, { allowAdd: true, surface: 'tui' });
  }

  return readAgentOrchestrationConfig({ directory });
}

function normalizeProviderId(value) {
  const providerId = normalizeString(value);
  if (!providerId || providerId === MODE_NATIVE) return null;
  return providerId;
}

function setAgentOrchestrationProvider(input = {}) {
  const providerId = normalizeProviderId(input.providerId);
  const mode = providerId == null ? MODE_NATIVE : getLegacyModeForProviderId(providerId);
  if (!mode) {
    const directory = normalizeString(input.directory);
    const scan = getConfigScan(directory);
    const existingEntry = [...scan.userEntries, ...scan.projectEntries].find((entry) => entry.providerId === providerId);
    if (!existingEntry) {
      const error = new Error('Invalid agent orchestration provider.');
      error.code = 'INVALID_PROVIDER';
      throw error;
    }
    const userTarget = getPrimaryUserOpenCodeConfigPath();
    const pathsToClean = Array.from(new Set([
      ...getPathsWithKnownEntries(getUserOpenCodeConfigCandidates()),
      ...getPathsWithKnownEntries(getLegacyUserOpenCodeConfigCandidates()),
      ...getPathsWithKnownEntries(getProjectOpenCodeConfigCandidates(directory)),
    ]));
    const tuiPathsToClean = Array.from(new Set(getPathsWithKnownEntries(getUserTuiConfigCandidates())));
    assertNoExpectedMtimeMismatches(input.expectedMtimeMsByPath);
    assertNoMtimeMismatches([...pathsToClean, ...tuiPathsToClean, userTarget], input.expectedMtimeMsByPath);
    for (const filePath of pathsToClean) {
      updateConfigPluginEntries(filePath, MODE_NATIVE, { allowAdd: false, surface: 'opencode' });
    }
    for (const filePath of tuiPathsToClean) {
      updateConfigPluginEntries(filePath, MODE_NATIVE, { allowAdd: false, surface: 'tui' });
    }
    updateConfigPluginEntries(userTarget, MODE_NATIVE, { allowAdd: true, surface: 'opencode', addEntry: existingEntry.rawEntry ?? existingEntry.entry });
    return readAgentOrchestrationConfig({ directory });
  }
  return setAgentOrchestrationMode({
    directory: input.directory,
    mode,
    expectedMtimeMsByPath: input.expectedMtimeMsByPath,
  });
}

function readAgentOrchestrationConfig(options = {}) {
  const directory = normalizeString(options.directory);
  const scan = getConfigScan(directory);
  const mode = getModeInfoFromScan(scan);
  return {
    mode,
    ...getProviderInfo(mode, [...scan.userEntries, ...scan.projectEntries, ...scan.tuiEntries]),
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
  setAgentOrchestrationProvider,
};
