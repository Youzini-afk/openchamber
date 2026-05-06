import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyEdits,
  modify as modifyJsonc,
  parse as parseJsonc,
  printParseErrorCode,
} from 'jsonc-parser';

const PLUGIN_NAME = 'opencode-magic-context';
const NPM_PLUGIN_NAME = '@cortexkit/opencode-magic-context';
const CONFIG_BASENAME = 'magic-context';
const SCHEMA_URL = 'https://raw.githubusercontent.com/cortexkit/opencode-magic-context/master/assets/magic-context.schema.json';

const JSONC_FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
};

const TOP_LEVEL_KEYS = [
  '$schema',
  'enabled',
  'auto_update',
  'ctx_reduce_enabled',
  'cache_ttl',
  'nudge_interval_tokens',
  'execute_threshold_percentage',
  'execute_threshold_tokens',
  'protected_tags',
  'auto_drop_tool_age',
  'drop_tool_structure',
  'clear_reasoning_age',
  'iteration_nudge_threshold',
  'history_budget_percentage',
  'historian_timeout_ms',
  'commit_cluster_trigger',
  'compaction_markers',
  'compressor',
  'historian',
  'dreamer',
  'embedding',
  'memory',
  'sidekick',
  'experimental',
];

const DREAMER_TASKS = new Set(['consolidate', 'verify', 'archive-stale', 'improve', 'maintain-docs']);
const EMBEDDING_PROVIDERS = new Set(['local', 'openai-compatible', 'off']);
const AGENT_MODES = new Set(['subagent', 'primary', 'all']);
const PERMISSION_VALUES = new Set(['ask', 'allow', 'deny']);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeNumberInRange(value, min, max) {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
}

function normalizeNumberMin(value, min) {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed < min) {
    return undefined;
  }
  return parsed;
}

function normalizePositiveInteger(value) {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function normalizeIntegerMin(value, min) {
  const parsed = normalizeNumberMin(value, min);
  if (parsed === undefined) {
    return undefined;
  }
  return Math.floor(parsed);
}

function normalizeIntegerInRange(value, min, max) {
  const parsed = normalizeNumberInRange(value, min, max);
  if (parsed === undefined) {
    return undefined;
  }
  return Math.floor(parsed);
}

function getOpenCodeConfigDir() {
  const envConfigDir = normalizeString(process.env.OPENCODE_CONFIG_DIR);
  if (envConfigDir) {
    return path.resolve(envConfigDir);
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

function detectConfigFile(dir, basename = CONFIG_BASENAME) {
  const jsoncPath = path.join(dir, `${basename}.jsonc`);
  const jsonPath = path.join(dir, `${basename}.json`);

  if (fs.existsSync(jsoncPath)) {
    return { exists: true, format: 'jsonc', path: jsoncPath };
  }
  if (fs.existsSync(jsonPath)) {
    return { exists: true, format: 'json', path: jsonPath };
  }
  return { exists: false, format: 'jsonc', path: jsoncPath };
}

function detectProjectConfigFile(directory) {
  if (!directory) {
    return null;
  }

  const root = detectConfigFile(directory);
  if (root.exists) {
    return root;
  }

  const dotOpenCode = detectConfigFile(path.join(directory, '.opencode'));
  if (dotOpenCode.exists) {
    return dotOpenCode;
  }

  return {
    exists: false,
    format: 'jsonc',
    path: path.join(directory, 'magic-context.jsonc'),
  };
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
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    return {};
  }

  return parseJsoncObject(content, filePath);
}

function getFileMtimeMs(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return fs.statSync(filePath).mtimeMs;
}

function getOpenCodeConfigCandidates(directory) {
  const configDir = getOpenCodeConfigDir();
  const candidates = [
    path.join(configDir, 'opencode.jsonc'),
    path.join(configDir, 'opencode.json'),
  ];

  if (directory) {
    candidates.push(
      path.join(directory, '.opencode', 'opencode.jsonc'),
      path.join(directory, '.opencode', 'opencode.json'),
      path.join(directory, 'opencode.jsonc'),
      path.join(directory, 'opencode.json'),
    );
  }

  return candidates;
}

function findPluginEntry(directory) {
  for (const configPath of getOpenCodeConfigCandidates(directory)) {
    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const config = readJsoncFile(configPath);
      const pluginEntries = [
        ...(Array.isArray(config.plugin) ? config.plugin : []),
        ...(Array.isArray(config.plugins) ? config.plugins : []),
      ];
      const entry = pluginEntries.find((value) => {
        if (typeof value !== 'string') {
          return false;
        }
        return value.includes(PLUGIN_NAME) || value.includes(NPM_PLUGIN_NAME);
      });

      if (entry) {
        return {
          detected: true,
          entry,
          configPath,
        };
      }
    } catch {
      // Ignore malformed OpenCode config here; the dedicated config UI can surface that.
    }
  }

  return {
    detected: false,
    entry: null,
    configPath: null,
  };
}

function createConfigModifiedError() {
  const error = new Error('Config was modified outside OpenChamber. Reload before saving again.');
  error.code = 'CONFIG_MODIFIED';
  return error;
}

function hasMtimeMismatch(filePath, expectedMtimeMs) {
  if (expectedMtimeMs == null) {
    return false;
  }

  const currentMtimeMs = getFileMtimeMs(filePath);
  if (currentMtimeMs == null) {
    return true;
  }

  return Math.abs(currentMtimeMs - expectedMtimeMs) > 1;
}

function normalizeStringMap(value) {
  if (typeof value === 'string') {
    const normalized = normalizeString(value);
    return normalized || undefined;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [normalizeString(key), normalizeString(entryValue)])
    .filter(([key, entryValue]) => key && entryValue);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeNumberMap(value, min, max) {
  if (typeof value === 'number' || typeof value === 'string') {
    return normalizeNumberInRange(value, min, max);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [normalizeString(key), normalizeNumberInRange(entryValue, min, max)])
    .filter(([key, entryValue]) => key && entryValue !== undefined);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeTokenThresholdMap(value) {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [normalizeString(key), normalizeIntegerInRange(entryValue, 5000, 2_000_000)])
    .filter(([key, entryValue]) => key && entryValue !== undefined);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeFallbackModels(value) {
  if (typeof value === 'string') {
    const model = normalizeString(value);
    return model || undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => {
      if (typeof entry === 'string') {
        return normalizeString(entry) || null;
      }
      if (!isPlainObject(entry)) {
        return null;
      }

      const model = normalizeString(entry.model);
      if (!model) {
        return null;
      }

      const normalized = { model };
      const variant = normalizeString(entry.variant);
      if (variant) normalized.variant = variant;
      const temperature = normalizeNumberInRange(entry.temperature, 0, 2);
      if (temperature !== undefined) normalized.temperature = temperature;
      const topP = normalizeNumberInRange(entry.top_p, 0, 1);
      if (topP !== undefined) normalized.top_p = topP;
      const maxTokens = normalizePositiveInteger(entry.maxTokens);
      if (maxTokens !== undefined) normalized.maxTokens = maxTokens;
      return normalized;
    })
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function normalizeBooleanRecord(value) {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([key, enabled]) => normalizeString(key) && typeof enabled === 'boolean')
    .map(([key, enabled]) => [normalizeString(key), enabled]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizePermission(value) {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const result = {};
  for (const key of ['edit', 'webfetch', 'doom_loop', 'external_directory']) {
    const permission = normalizeString(value[key]);
    if (PERMISSION_VALUES.has(permission)) {
      result[key] = permission;
    }
  }

  const bash = value.bash;
  if (typeof bash === 'string') {
    const permission = normalizeString(bash);
    if (PERMISSION_VALUES.has(permission)) {
      result.bash = permission;
    }
  } else if (isPlainObject(bash)) {
    const entries = Object.entries(bash)
      .map(([command, permission]) => [normalizeString(command), normalizeString(permission)])
      .filter(([command, permission]) => command && PERMISSION_VALUES.has(permission));
    if (entries.length > 0) {
      result.bash = Object.fromEntries(entries);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function assignStringField(target, input, key) {
  if (!hasOwn(input, key)) return;
  const value = normalizeString(input[key]);
  if (value) target[key] = value;
}

function assignNumberField(target, input, key, min, max) {
  if (!hasOwn(input, key)) return;
  const value = normalizeNumberInRange(input[key], min, max);
  if (value !== undefined) target[key] = value;
}

function assignPositiveIntegerField(target, input, key) {
  if (!hasOwn(input, key)) return;
  const value = normalizePositiveInteger(input[key]);
  if (value !== undefined) target[key] = value;
}

function normalizeAgentConfig(input, extra = {}) {
  if (!isPlainObject(input)) {
    return undefined;
  }

  const result = {};
  assignStringField(result, input, 'model');
  assignStringField(result, input, 'variant');
  assignStringField(result, input, 'prompt');
  assignStringField(result, input, 'description');
  assignNumberField(result, input, 'temperature', 0, 2);
  assignNumberField(result, input, 'top_p', 0, 1);
  assignPositiveIntegerField(result, input, 'maxTokens');
  assignPositiveIntegerField(result, input, 'maxSteps');

  const fallbackModels = normalizeFallbackModels(input.fallback_models);
  if (fallbackModels !== undefined) result.fallback_models = fallbackModels;

  const tools = normalizeBooleanRecord(input.tools);
  if (tools) result.tools = tools;

  const permission = normalizePermission(input.permission);
  if (permission) result.permission = permission;

  const mode = normalizeString(input.mode);
  if (AGENT_MODES.has(mode)) result.mode = mode;

  const color = normalizeString(input.color);
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) result.color = color;

  if (typeof input.disable === 'boolean') result.disable = input.disable;

  extra(result, input);

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeHistorianConfig(value) {
  return normalizeAgentConfig(value, (result, input) => {
    if (typeof input.two_pass === 'boolean') result.two_pass = input.two_pass;
  });
}

function normalizeDreamerConfig(value) {
  return normalizeAgentConfig(value, (result, input) => {
    if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
    assignStringField(result, input, 'schedule');
    const maxRuntime = normalizeIntegerMin(input.max_runtime_minutes, 10);
    if (maxRuntime !== undefined) result.max_runtime_minutes = maxRuntime;
    const taskTimeout = normalizeIntegerMin(input.task_timeout_minutes, 5);
    if (taskTimeout !== undefined) result.task_timeout_minutes = taskTimeout;
    if (typeof input.inject_docs === 'boolean') result.inject_docs = input.inject_docs;
    if (Array.isArray(input.tasks)) {
      const tasks = input.tasks.map(normalizeString).filter((task) => DREAMER_TASKS.has(task));
      if (tasks.length > 0) result.tasks = Array.from(new Set(tasks));
    }

    if (isPlainObject(input.user_memories)) {
      const userMemories = {};
      if (typeof input.user_memories.enabled === 'boolean') userMemories.enabled = input.user_memories.enabled;
      const threshold = normalizeIntegerInRange(input.user_memories.promotion_threshold, 2, 20);
      if (threshold !== undefined) userMemories.promotion_threshold = threshold;
      if (Object.keys(userMemories).length > 0) result.user_memories = userMemories;
    }

    if (isPlainObject(input.pin_key_files)) {
      const pinKeyFiles = {};
      if (typeof input.pin_key_files.enabled === 'boolean') pinKeyFiles.enabled = input.pin_key_files.enabled;
      const budget = normalizeIntegerInRange(input.pin_key_files.token_budget, 2000, 30000);
      if (budget !== undefined) pinKeyFiles.token_budget = budget;
      const minReads = normalizeIntegerInRange(input.pin_key_files.min_reads, 2, 20);
      if (minReads !== undefined) pinKeyFiles.min_reads = minReads;
      if (Object.keys(pinKeyFiles).length > 0) result.pin_key_files = pinKeyFiles;
    }
  });
}

function normalizeSidekickConfig(value) {
  return normalizeAgentConfig(value, (result, input) => {
    if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
    const timeout = normalizeIntegerMin(input.timeout_ms, 1);
    if (timeout !== undefined) result.timeout_ms = timeout;
    assignStringField(result, input, 'system_prompt');
  });
}

function normalizeCommitClusterTrigger(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
  const minClusters = normalizeIntegerMin(value.min_clusters, 1);
  if (minClusters !== undefined) result.min_clusters = minClusters;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCompressor(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
  const minRatio = normalizeIntegerInRange(value.min_compartment_ratio, 100, 10000);
  if (minRatio !== undefined) result.min_compartment_ratio = minRatio;
  const maxDepth = normalizeIntegerInRange(value.max_merge_depth, 1, 5);
  if (maxDepth !== undefined) result.max_merge_depth = maxDepth;
  const cooldown = normalizeIntegerMin(value.cooldown_ms, 60000);
  if (cooldown !== undefined) result.cooldown_ms = cooldown;
  const maxPerPass = normalizeIntegerInRange(value.max_compartments_per_pass, 3, 50);
  if (maxPerPass !== undefined) result.max_compartments_per_pass = maxPerPass;
  const grace = normalizeIntegerInRange(value.grace_compartments, 0, 100);
  if (grace !== undefined) result.grace_compartments = grace;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeEmbedding(value) {
  if (!isPlainObject(value)) return undefined;
  const provider = normalizeString(value.provider);
  if (!EMBEDDING_PROVIDERS.has(provider)) return undefined;
  const result = { provider };
  const model = normalizeString(value.model);
  const endpoint = normalizeString(value.endpoint);
  const apiKey = normalizeString(value.api_key);

  if (model) result.model = model;
  if (endpoint) result.endpoint = endpoint;
  if (apiKey) result.api_key = apiKey;

  if (provider === 'openai-compatible' && (!result.model || !result.endpoint)) {
    const error = new Error('embedding.model and embedding.endpoint are required when provider is openai-compatible.');
    error.code = 'INVALID_MAGIC_CONTEXT_CONFIG';
    throw error;
  }

  return result;
}

function normalizeMemory(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
  if (typeof value.auto_promote === 'boolean') result.auto_promote = value.auto_promote;
  const budget = normalizeIntegerInRange(value.injection_budget_tokens, 500, 20000);
  if (budget !== undefined) result.injection_budget_tokens = budget;
  const threshold = normalizeIntegerMin(value.retrieval_count_promotion_threshold, 1);
  if (threshold !== undefined) result.retrieval_count_promotion_threshold = threshold;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeExperimental(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (typeof value.temporal_awareness === 'boolean') result.temporal_awareness = value.temporal_awareness;

  if (isPlainObject(value.git_commit_indexing)) {
    const gitCommitIndexing = {};
    if (typeof value.git_commit_indexing.enabled === 'boolean') gitCommitIndexing.enabled = value.git_commit_indexing.enabled;
    const sinceDays = normalizeIntegerInRange(value.git_commit_indexing.since_days, 7, 3650);
    if (sinceDays !== undefined) gitCommitIndexing.since_days = sinceDays;
    const maxCommits = normalizeIntegerInRange(value.git_commit_indexing.max_commits, 100, 20000);
    if (maxCommits !== undefined) gitCommitIndexing.max_commits = maxCommits;
    if (Object.keys(gitCommitIndexing).length > 0) result.git_commit_indexing = gitCommitIndexing;
  }

  if (isPlainObject(value.auto_search)) {
    const autoSearch = {};
    if (typeof value.auto_search.enabled === 'boolean') autoSearch.enabled = value.auto_search.enabled;
    const threshold = normalizeNumberInRange(value.auto_search.score_threshold, 0.3, 0.95);
    if (threshold !== undefined) autoSearch.score_threshold = threshold;
    const minChars = normalizeIntegerInRange(value.auto_search.min_prompt_chars, 5, 500);
    if (minChars !== undefined) autoSearch.min_prompt_chars = minChars;
    if (Object.keys(autoSearch).length > 0) result.auto_search = autoSearch;
  }

  if (isPlainObject(value.caveman_text_compression)) {
    const caveman = {};
    if (typeof value.caveman_text_compression.enabled === 'boolean') caveman.enabled = value.caveman_text_compression.enabled;
    const minChars = normalizeIntegerInRange(value.caveman_text_compression.min_chars, 100, 10000);
    if (minChars !== undefined) caveman.min_chars = minChars;
    if (Object.keys(caveman).length > 0) result.caveman_text_compression = caveman;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeMagicContextConfig(input) {
  if (!isPlainObject(input)) return {};
  const result = {};

  if (hasOwn(input, '$schema')) {
    const schema = normalizeString(input.$schema);
    if (schema) result.$schema = schema;
  }
  if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
  if (typeof input.auto_update === 'boolean') result.auto_update = input.auto_update;
  if (typeof input.ctx_reduce_enabled === 'boolean') result.ctx_reduce_enabled = input.ctx_reduce_enabled;
  if (typeof input.drop_tool_structure === 'boolean') result.drop_tool_structure = input.drop_tool_structure;
  if (typeof input.compaction_markers === 'boolean') result.compaction_markers = input.compaction_markers;

  const cacheTtl = normalizeStringMap(input.cache_ttl);
  if (cacheTtl !== undefined) result.cache_ttl = cacheTtl;
  const executeThresholdPercentage = normalizeNumberMap(input.execute_threshold_percentage, 20, 80);
  if (executeThresholdPercentage !== undefined) result.execute_threshold_percentage = executeThresholdPercentage;
  const executeThresholdTokens = normalizeTokenThresholdMap(input.execute_threshold_tokens);
  if (executeThresholdTokens !== undefined) result.execute_threshold_tokens = executeThresholdTokens;

  const nudgeInterval = normalizeIntegerMin(input.nudge_interval_tokens, 1000);
  if (nudgeInterval !== undefined) result.nudge_interval_tokens = nudgeInterval;
  const protectedTags = normalizeIntegerInRange(input.protected_tags, 1, 100);
  if (protectedTags !== undefined) result.protected_tags = protectedTags;
  const autoDropAge = normalizeIntegerMin(input.auto_drop_tool_age, 10);
  if (autoDropAge !== undefined) result.auto_drop_tool_age = autoDropAge;
  const clearReasoningAge = normalizeIntegerMin(input.clear_reasoning_age, 10);
  if (clearReasoningAge !== undefined) result.clear_reasoning_age = clearReasoningAge;
  const iterationThreshold = normalizeIntegerMin(input.iteration_nudge_threshold, 5);
  if (iterationThreshold !== undefined) result.iteration_nudge_threshold = iterationThreshold;
  const historyBudget = normalizeNumberInRange(input.history_budget_percentage, 0.05, 0.5);
  if (historyBudget !== undefined) result.history_budget_percentage = historyBudget;
  const historianTimeout = normalizeIntegerMin(input.historian_timeout_ms, 60000);
  if (historianTimeout !== undefined) result.historian_timeout_ms = historianTimeout;

  const commitClusterTrigger = normalizeCommitClusterTrigger(input.commit_cluster_trigger);
  if (commitClusterTrigger) result.commit_cluster_trigger = commitClusterTrigger;
  const compressor = normalizeCompressor(input.compressor);
  if (compressor) result.compressor = compressor;
  const historian = normalizeHistorianConfig(input.historian);
  if (historian) result.historian = historian;
  const dreamer = normalizeDreamerConfig(input.dreamer);
  if (dreamer) result.dreamer = dreamer;
  const sidekick = normalizeSidekickConfig(input.sidekick);
  if (sidekick) result.sidekick = sidekick;
  const embedding = normalizeEmbedding(input.embedding);
  if (embedding) result.embedding = embedding;
  const memory = normalizeMemory(input.memory);
  if (memory) result.memory = memory;
  const experimental = normalizeExperimental(input.experimental);
  if (experimental) result.experimental = experimental;

  return result;
}

function updateJsoncProperty(content, key, shouldUpdate, value) {
  if (!shouldUpdate) {
    return content;
  }

  const nextValue = value === undefined ? undefined : value;
  const edits = modifyJsonc(content, [key], nextValue, {
    formattingOptions: JSONC_FORMATTING_OPTIONS,
  });
  return applyEdits(content, edits);
}

function readMagicContextConfig(options = {}) {
  const directory = normalizeString(options.directory);
  const configDir = getOpenCodeConfigDir();
  const targetDetection = detectConfigFile(configDir);
  const targetConfig = readJsoncFile(targetDetection.path);
  const projectDetection = detectProjectConfigFile(directory);
  const projectConfig = projectDetection?.exists ? readJsoncFile(projectDetection.path) : {};

  return {
    plugin: findPluginEntry(directory),
    target: {
      scope: 'user',
      path: targetDetection.path,
      exists: targetDetection.exists,
      format: targetDetection.format,
      mtimeMs: getFileMtimeMs(targetDetection.path),
    },
    project: {
      path: projectDetection?.exists ? projectDetection.path : null,
      exists: Boolean(projectDetection?.exists),
      overriddenKeys: Object.keys(projectConfig).sort(),
    },
    schemaUrl: SCHEMA_URL,
    raw: targetConfig,
    projectRaw: projectConfig,
  };
}

function saveMagicContextConfig(input = {}) {
  const configDir = getOpenCodeConfigDir();
  const targetDetection = detectConfigFile(configDir);
  const targetPath = targetDetection.path;

  if (hasMtimeMismatch(targetPath, input.expectedMtimeMs)) {
    throw createConfigModifiedError();
  }

  const originalConfig = isPlainObject(input.config) ? input.config : {};
  const sanitized = sanitizeMagicContextConfig(originalConfig);
  const requestedKeys = new Set(Object.keys(originalConfig).filter((key) => TOP_LEVEL_KEYS.includes(key)));
  if (!requestedKeys.has('$schema') && !targetDetection.exists) {
    sanitized.$schema = SCHEMA_URL;
    requestedKeys.add('$schema');
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  let content = targetDetection.exists ? fs.readFileSync(targetPath, 'utf8') : '{\n}\n';
  if (!content.trim()) {
    content = '{\n}\n';
  }

  for (const key of TOP_LEVEL_KEYS) {
    content = updateJsoncProperty(content, key, requestedKeys.has(key), sanitized[key]);
  }

  parseJsoncObject(content, targetPath);

  if (targetDetection.exists) {
    try {
      fs.copyFileSync(targetPath, `${targetPath}.openchamber.backup`);
    } catch {
      // Backup failure should not prevent the requested config write.
    }
  }

  fs.writeFileSync(targetPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

  return readMagicContextConfig();
}

export {
  readMagicContextConfig,
  saveMagicContextConfig,
  sanitizeMagicContextConfig,
};
