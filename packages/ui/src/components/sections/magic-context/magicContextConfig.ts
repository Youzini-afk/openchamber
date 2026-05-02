export type MagicContextScalarMap<T extends string | number> = T | string | Record<string, T | string>;

export type MagicContextAgentFallbackObject = {
  model: string;
  variant?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
};

export type MagicContextAgentFallbackModels = string | Array<string | MagicContextAgentFallbackObject>;

export type MagicContextAgentConfig = Record<string, unknown> & {
  model?: string;
  fallback_models?: MagicContextAgentFallbackModels;
  variant?: string;
  temperature?: number;
  top_p?: number;
  prompt?: string;
  maxTokens?: number;
  maxSteps?: number;
  disable?: boolean;
};

export type MagicContextConfig = Record<string, unknown> & {
  enabled?: boolean;
  auto_update?: boolean;
  ctx_reduce_enabled?: boolean;
  cache_ttl?: MagicContextScalarMap<string>;
  execute_threshold_percentage?: MagicContextScalarMap<number>;
  execute_threshold_tokens?: Record<string, number>;
  historian?: MagicContextAgentConfig & { two_pass?: boolean };
  dreamer?: MagicContextAgentConfig & {
    enabled?: boolean;
    schedule?: string;
    tasks?: string[];
    max_runtime_minutes?: number;
    task_timeout_minutes?: number;
    inject_docs?: boolean;
  };
  embedding?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  sidekick?: MagicContextAgentConfig & {
    enabled?: boolean;
    timeout_ms?: number;
    system_prompt?: string;
  };
};

export interface MagicContextConfigResponseLike {
  raw?: MagicContextConfig;
  project?: {
    overriddenKeys?: string[];
  };
}

export interface MagicContextSavePayload {
  expectedMtimeMs: number | null;
  config: MagicContextConfig;
}

export interface MagicContextFallbackRow {
  id: string;
  model: string;
  variant: string;
  maxTokens: string;
  temperature?: string;
  top_p?: string;
  originalType: 'string' | 'object';
}

const DREAMER_TASKS = new Set(['consolidate', 'verify', 'archive-stale', 'improve', 'maintain-docs']);
const EMBEDDING_PROVIDERS = new Set(['local', 'openai-compatible', 'off']);
const AGENT_MODES = new Set(['subagent', 'primary', 'all']);
const TOP_LEVEL_MAGIC_CONTEXT_KEYS = [
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

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? {}));

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizeString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const hasOwn = (input: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(input, key);

const normalizeFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const normalized = normalizeString(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeNumberInRange = (value: unknown, min: number, max: number): number | undefined => {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed < min || parsed > max) return undefined;
  return parsed;
};

const normalizeNumberMin = (value: unknown, min: number): number | undefined => {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed < min) return undefined;
  return parsed;
};

const normalizePositiveInteger = (value: unknown): number | undefined => {
  const parsed = normalizeFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return Math.floor(parsed);
};

const normalizeIntegerMin = (value: unknown, min: number): number | undefined => {
  const parsed = normalizeNumberMin(value, min);
  return parsed === undefined ? undefined : Math.floor(parsed);
};

const normalizeIntegerInRange = (value: unknown, min: number, max: number): number | undefined => {
  const parsed = normalizeNumberInRange(value, min, max);
  return parsed === undefined ? undefined : Math.floor(parsed);
};

const normalizeStringMap = (value: unknown): string | Record<string, string> | undefined => {
  if (typeof value === 'string') {
    const normalized = normalizeString(value);
    return normalized || undefined;
  }
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, entryValue]) => [normalizeString(key), normalizeString(entryValue)])
    .filter(([key, entryValue]) => key && entryValue);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeNumberMap = (value: unknown, min: number, max: number): number | Record<string, number> | undefined => {
  if (typeof value === 'number' || typeof value === 'string') {
    return normalizeNumberInRange(value, min, max);
  }
  if (!isPlainObject(value)) return undefined;
  const entries: Array<[string, number]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeNumberInRange(entryValue, min, max);
    if (normalizedKey && normalizedValue !== undefined) {
      entries.push([normalizedKey, normalizedValue]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeTokenThresholdMap = (value: unknown): Record<string, number> | undefined => {
  if (!isPlainObject(value)) return undefined;
  const entries: Array<[string, number]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeIntegerInRange(entryValue, 5000, 2_000_000);
    if (normalizedKey && normalizedValue !== undefined) {
      entries.push([normalizedKey, normalizedValue]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeFallbackObject = (value: unknown): MagicContextAgentFallbackObject | null => {
  if (!isPlainObject(value)) return null;
  const model = normalizeString(value.model);
  if (!model) return null;
  const normalized: MagicContextAgentFallbackObject = { model };
  const variant = normalizeString(value.variant);
  if (variant) normalized.variant = variant;
  const maxTokens = normalizePositiveInteger(value.maxTokens);
  if (maxTokens !== undefined) normalized.maxTokens = maxTokens;
  const temperature = normalizeNumberInRange(value.temperature, 0, 2);
  if (temperature !== undefined) normalized.temperature = temperature;
  const topP = normalizeNumberInRange(value.top_p, 0, 1);
  if (topP !== undefined) normalized.top_p = topP;
  return normalized;
};

const normalizeFallbackModels = (value: unknown): MagicContextAgentFallbackModels | undefined => {
  if (typeof value === 'string') {
    const model = normalizeString(value);
    return model || undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((entry) => (typeof entry === 'string' ? normalizeString(entry) || null : normalizeFallbackObject(entry)))
    .filter(Boolean) as Array<string | MagicContextAgentFallbackObject>;
  return entries.length > 0 ? entries : undefined;
};

const normalizeBooleanRecord = (value: unknown): Record<string, boolean> | undefined => {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, enabled]) => normalizeString(key) && typeof enabled === 'boolean')
    .map(([key, enabled]) => [normalizeString(key), enabled as boolean]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const assignString = (target: MagicContextAgentConfig, input: Record<string, unknown>, key: string) => {
  if (!hasOwn(input, key)) return;
  const value = normalizeString(input[key]);
  if (value) target[key] = value;
};

const assignNumber = (target: MagicContextAgentConfig, input: Record<string, unknown>, key: string, min: number, max: number) => {
  if (!hasOwn(input, key)) return;
  const value = normalizeNumberInRange(input[key], min, max);
  if (value !== undefined) target[key] = value;
};

const assignPositiveInteger = (target: MagicContextAgentConfig, input: Record<string, unknown>, key: string) => {
  if (!hasOwn(input, key)) return;
  const value = normalizePositiveInteger(input[key]);
  if (value !== undefined) target[key] = value;
};

function normalizeAgentConfig(input: unknown, extra?: (result: MagicContextAgentConfig, input: Record<string, unknown>) => void): MagicContextAgentConfig | undefined {
  if (!isPlainObject(input)) return undefined;
  const result: MagicContextAgentConfig = {};

  assignString(result, input, 'model');
  assignString(result, input, 'variant');
  assignString(result, input, 'prompt');
  assignString(result, input, 'description');
  assignNumber(result, input, 'temperature', 0, 2);
  assignNumber(result, input, 'top_p', 0, 1);
  assignPositiveInteger(result, input, 'maxTokens');
  assignPositiveInteger(result, input, 'maxSteps');

  const fallbackModels = normalizeFallbackModels(input.fallback_models);
  if (fallbackModels !== undefined) result.fallback_models = fallbackModels;

  const tools = normalizeBooleanRecord(input.tools);
  if (tools) result.tools = tools;

  const mode = normalizeString(input.mode);
  if (AGENT_MODES.has(mode)) result.mode = mode;

  const color = normalizeString(input.color);
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) result.color = color;

  if (typeof input.disable === 'boolean') result.disable = input.disable;
  if (isPlainObject(input.permission) && Object.keys(input.permission).length > 0) result.permission = input.permission;

  extra?.(result, input);
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeDreamerConfig(value: unknown): MagicContextConfig['dreamer'] | undefined {
  return normalizeAgentConfig(value, (result, input) => {
    if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
    assignString(result, input, 'schedule');
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
      const userMemories: Record<string, unknown> = {};
      if (typeof input.user_memories.enabled === 'boolean') userMemories.enabled = input.user_memories.enabled;
      const threshold = normalizeIntegerInRange(input.user_memories.promotion_threshold, 2, 20);
      if (threshold !== undefined) userMemories.promotion_threshold = threshold;
      if (Object.keys(userMemories).length > 0) result.user_memories = userMemories;
    }
    if (isPlainObject(input.pin_key_files)) {
      const pinKeyFiles: Record<string, unknown> = {};
      if (typeof input.pin_key_files.enabled === 'boolean') pinKeyFiles.enabled = input.pin_key_files.enabled;
      const budget = normalizeIntegerInRange(input.pin_key_files.token_budget, 2000, 30000);
      if (budget !== undefined) pinKeyFiles.token_budget = budget;
      const minReads = normalizeIntegerInRange(input.pin_key_files.min_reads, 2, 20);
      if (minReads !== undefined) pinKeyFiles.min_reads = minReads;
      if (Object.keys(pinKeyFiles).length > 0) result.pin_key_files = pinKeyFiles;
    }
  }) as MagicContextConfig['dreamer'] | undefined;
}

function normalizeSidekickConfig(value: unknown): MagicContextConfig['sidekick'] | undefined {
  return normalizeAgentConfig(value, (result, input) => {
    if (typeof input.enabled === 'boolean') result.enabled = input.enabled;
    const timeout = normalizeIntegerMin(input.timeout_ms, 1);
    if (timeout !== undefined) result.timeout_ms = timeout;
    assignString(result, input, 'system_prompt');
  }) as MagicContextConfig['sidekick'] | undefined;
}

const normalizeObjectWithFields = (
  value: unknown,
  builder: (result: Record<string, unknown>, input: Record<string, unknown>) => void,
): Record<string, unknown> | undefined => {
  if (!isPlainObject(value)) return undefined;
  const result: Record<string, unknown> = {};
  builder(result, value);
  return Object.keys(result).length > 0 ? result : undefined;
};

export function normalizeMagicContextConfig(input: unknown): MagicContextConfig {
  if (!isPlainObject(input)) return {};
  const result: MagicContextConfig = {};

  const schema = normalizeString(input.$schema);
  if (schema) result.$schema = schema;
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

  const commitClusterTrigger = normalizeObjectWithFields(input.commit_cluster_trigger, (target, source) => {
    if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
    const minClusters = normalizeIntegerMin(source.min_clusters, 1);
    if (minClusters !== undefined) target.min_clusters = minClusters;
  });
  if (commitClusterTrigger) result.commit_cluster_trigger = commitClusterTrigger;

  const compressor = normalizeObjectWithFields(input.compressor, (target, source) => {
    if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
    const minRatio = normalizeIntegerInRange(source.min_compartment_ratio, 100, 10000);
    if (minRatio !== undefined) target.min_compartment_ratio = minRatio;
    const maxDepth = normalizeIntegerInRange(source.max_merge_depth, 1, 5);
    if (maxDepth !== undefined) target.max_merge_depth = maxDepth;
    const cooldown = normalizeIntegerMin(source.cooldown_ms, 60000);
    if (cooldown !== undefined) target.cooldown_ms = cooldown;
    const maxPerPass = normalizeIntegerInRange(source.max_compartments_per_pass, 3, 50);
    if (maxPerPass !== undefined) target.max_compartments_per_pass = maxPerPass;
    const grace = normalizeIntegerInRange(source.grace_compartments, 0, 100);
    if (grace !== undefined) target.grace_compartments = grace;
  });
  if (compressor) result.compressor = compressor;

  const historian = normalizeAgentConfig(input.historian, (target, source) => {
    if (typeof source.two_pass === 'boolean') target.two_pass = source.two_pass;
  });
  if (historian) result.historian = historian;
  const dreamer = normalizeDreamerConfig(input.dreamer);
  if (dreamer) result.dreamer = dreamer;
  const sidekick = normalizeSidekickConfig(input.sidekick);
  if (sidekick) result.sidekick = sidekick;

  const embedding = normalizeObjectWithFields(input.embedding, (target, source) => {
    const provider = normalizeString(source.provider);
    if (EMBEDDING_PROVIDERS.has(provider)) target.provider = provider;
    const model = normalizeString(source.model);
    if (model) target.model = model;
    const endpoint = normalizeString(source.endpoint);
    if (endpoint) target.endpoint = endpoint;
    const apiKey = normalizeString(source.api_key);
    if (apiKey) target.api_key = apiKey;
  });
  if (embedding) result.embedding = embedding;

  const memory = normalizeObjectWithFields(input.memory, (target, source) => {
    if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
    if (typeof source.auto_promote === 'boolean') target.auto_promote = source.auto_promote;
    const budget = normalizeIntegerInRange(source.injection_budget_tokens, 500, 20000);
    if (budget !== undefined) target.injection_budget_tokens = budget;
    const threshold = normalizeIntegerMin(source.retrieval_count_promotion_threshold, 1);
    if (threshold !== undefined) target.retrieval_count_promotion_threshold = threshold;
  });
  if (memory) result.memory = memory;

  const experimental = normalizeObjectWithFields(input.experimental, (target, source) => {
    if (typeof source.temporal_awareness === 'boolean') target.temporal_awareness = source.temporal_awareness;
    if (isPlainObject(source.git_commit_indexing)) {
      const nested: Record<string, unknown> = {};
      if (typeof source.git_commit_indexing.enabled === 'boolean') nested.enabled = source.git_commit_indexing.enabled;
      const sinceDays = normalizeIntegerInRange(source.git_commit_indexing.since_days, 7, 3650);
      if (sinceDays !== undefined) nested.since_days = sinceDays;
      const maxCommits = normalizeIntegerInRange(source.git_commit_indexing.max_commits, 100, 20000);
      if (maxCommits !== undefined) nested.max_commits = maxCommits;
      if (Object.keys(nested).length > 0) target.git_commit_indexing = nested;
    }
    if (isPlainObject(source.auto_search)) {
      const nested: Record<string, unknown> = {};
      if (typeof source.auto_search.enabled === 'boolean') nested.enabled = source.auto_search.enabled;
      const threshold = normalizeNumberInRange(source.auto_search.score_threshold, 0.3, 0.95);
      if (threshold !== undefined) nested.score_threshold = threshold;
      const minChars = normalizeIntegerInRange(source.auto_search.min_prompt_chars, 5, 500);
      if (minChars !== undefined) nested.min_prompt_chars = minChars;
      if (Object.keys(nested).length > 0) target.auto_search = nested;
    }
    if (isPlainObject(source.caveman_text_compression)) {
      const nested: Record<string, unknown> = {};
      if (typeof source.caveman_text_compression.enabled === 'boolean') nested.enabled = source.caveman_text_compression.enabled;
      const minChars = normalizeIntegerInRange(source.caveman_text_compression.min_chars, 100, 10000);
      if (minChars !== undefined) nested.min_chars = minChars;
      if (Object.keys(nested).length > 0) target.caveman_text_compression = nested;
    }
  });
  if (experimental) result.experimental = experimental;

  return result;
}

export function agentFallbackModelsToRows(value: unknown): MagicContextFallbackRow[] {
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return entries.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        id: `fallback-${index}`,
        model: entry,
        variant: '',
        maxTokens: '',
        originalType: 'string' as const,
      };
    }

    const objectEntry = isPlainObject(entry) ? entry : {};
    return {
      id: `fallback-${index}`,
      model: normalizeString(objectEntry.model),
      variant: normalizeString(objectEntry.variant),
      maxTokens: objectEntry.maxTokens == null ? '' : String(objectEntry.maxTokens),
      temperature: objectEntry.temperature == null ? undefined : String(objectEntry.temperature),
      top_p: objectEntry.top_p == null ? undefined : String(objectEntry.top_p),
      originalType: 'object' as const,
    };
  });
}

export function agentFallbackRowsToConfig(rows: MagicContextFallbackRow[]): MagicContextAgentFallbackModels | undefined {
  const entries = rows
    .map((row) => {
      const model = normalizeString(row.model);
      if (!model) return null;
      const variant = normalizeString(row.variant);
      const maxTokens = normalizePositiveInteger(row.maxTokens);
      const temperature = normalizeNumberInRange(row.temperature, 0, 2);
      const topP = normalizeNumberInRange(row.top_p, 0, 1);
      const hasObjectFields = row.originalType === 'object'
        || variant
        || maxTokens !== undefined
        || temperature !== undefined
        || topP !== undefined;
      if (!hasObjectFields) return model;
      return {
        model,
        ...(variant ? { variant } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
      };
    })
    .filter(Boolean) as Array<string | MagicContextAgentFallbackObject>;

  return entries.length > 0 ? entries : undefined;
}

export function createMagicContextDraftFromConfig(config: MagicContextConfigResponseLike | null | undefined): MagicContextConfig {
  return cloneJson(config?.raw ?? {});
}

export function buildMagicContextSavePayload(expectedMtimeMs: number | null, draft: MagicContextConfig): MagicContextSavePayload {
  const normalized = normalizeMagicContextConfig(draft);
  const config: MagicContextConfig = {};

  for (const key of TOP_LEVEL_MAGIC_CONTEXT_KEYS) {
    if (!hasOwn(draft, key)) continue;
    config[key] = hasOwn(normalized, key) ? normalized[key] : draft[key];
  }

  return {
    expectedMtimeMs,
    config,
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

export function stableStringifyMagicContext(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hasMagicContextDraftChanges(initial: MagicContextConfig, draft: MagicContextConfig): boolean {
  return stableStringifyMagicContext(normalizeMagicContextConfig(initial)) !== stableStringifyMagicContext(normalizeMagicContextConfig(draft));
}

export function parseModelRef(model: string | undefined | null): { providerId: string; modelId: string } {
  const normalized = normalizeString(model);
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
    return { providerId: '', modelId: normalized };
  }
  return {
    providerId: normalized.slice(0, slashIndex),
    modelId: normalized.slice(slashIndex + 1),
  };
}

export function joinModelRef(providerId: string, modelId: string): string {
  const provider = normalizeString(providerId);
  const model = normalizeString(modelId);
  return provider && model ? `${provider}/${model}` : model;
}

export function countFallbackModels(value: unknown): number {
  if (typeof value === 'string') return normalizeString(value) ? 1 : 0;
  if (!Array.isArray(value)) return 0;
  return value.filter((entry) => {
    if (typeof entry === 'string') return Boolean(normalizeString(entry));
    return Boolean(isPlainObject(entry) && normalizeString(entry.model));
  }).length;
}
