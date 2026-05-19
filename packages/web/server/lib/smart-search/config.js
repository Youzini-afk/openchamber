const CONFIG_KEYS = new Set([
  'XAI_API_URL',
  'XAI_API_KEY',
  'XAI_MODEL',
  'XAI_TOOLS',
  'OPENAI_COMPATIBLE_API_URL',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_MODEL',
  'SMART_SEARCH_VALIDATION_LEVEL',
  'SMART_SEARCH_FALLBACK_MODE',
  'SMART_SEARCH_MINIMUM_PROFILE',
  'EXA_API_KEY',
  'EXA_BASE_URL',
  'EXA_TIMEOUT_SECONDS',
  'CONTEXT7_API_KEY',
  'CONTEXT7_BASE_URL',
  'CONTEXT7_TIMEOUT_SECONDS',
  'ZHIPU_API_KEY',
  'ZHIPU_API_URL',
  'ZHIPU_SEARCH_ENGINE',
  'ZHIPU_TIMEOUT_SECONDS',
  'TAVILY_API_KEY',
  'TAVILY_API_URL',
  'TAVILY_ENABLED',
  'TAVILY_TIMEOUT_SECONDS',
  'FIRECRAWL_API_KEY',
  'FIRECRAWL_API_URL',
  'SMART_SEARCH_DEBUG',
  'SMART_SEARCH_LOG_LEVEL',
  'SMART_SEARCH_LOG_DIR',
  'SMART_SEARCH_RETRY_MAX_ATTEMPTS',
  'SMART_SEARCH_RETRY_MULTIPLIER',
  'SMART_SEARCH_RETRY_MAX_WAIT',
  'SMART_SEARCH_OUTPUT_CLEANUP',
  'SMART_SEARCH_LOG_TO_FILE',
  'SSL_VERIFY',
]);

const SECRET_PATTERN = /(KEY|TOKEN|SECRET)/;
const DEFAULT_BIN = process.platform === 'win32' ? 'smart-search.cmd' : 'smart-search';

export const SMART_SEARCH_CONFIG_KEYS = [...CONFIG_KEYS];

export const isSmartSearchConfigKey = (key) => CONFIG_KEYS.has(key);

export const isSmartSearchSecretKey = (key) => SECRET_PATTERN.test(key);

export const resolveSmartSearchBinary = (env = process.env) => {
  const override = typeof env.SMART_SEARCH_BIN === 'string' ? env.SMART_SEARCH_BIN.trim() : '';
  return override || DEFAULT_BIN;
};

export const maskSmartSearchSecret = (value) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (!text) return '';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}${'*'.repeat(text.length - 8)}${text.slice(-4)}`;
};

export const redactSmartSearchSecrets = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(sk-[A-Za-z0-9_\-]{8,})/g, (match) => maskSmartSearchSecret(match))
    .replace(/([A-Za-z0-9_\-]{24,})/g, (match) => {
      if (/^[A-Za-z0-9_\-]+$/.test(match)) return maskSmartSearchSecret(match);
      return match;
    });
};

export const normalizeSmartSearchPatch = (payload) => {
  if (!payload || typeof payload !== 'object') {
    const error = new Error('Expected JSON body with set and/or unset fields.');
    error.status = 400;
    throw error;
  }

  const rawSet = payload.set;
  const rawUnset = payload.unset;
  const set = {};
  const unset = [];

  if (rawSet !== undefined) {
    if (!rawSet || typeof rawSet !== 'object' || Array.isArray(rawSet)) {
      const error = new Error('set must be an object.');
      error.status = 400;
      throw error;
    }
    for (const [rawKey, rawValue] of Object.entries(rawSet)) {
      const key = String(rawKey).trim().toUpperCase();
      if (!CONFIG_KEYS.has(key)) {
        const error = new Error(`Unsupported Smart Search config key: ${key}`);
        error.status = 400;
        throw error;
      }
      if (rawValue === null || rawValue === undefined) {
        unset.push(key);
        continue;
      }
      set[key] = String(rawValue);
    }
  }

  if (rawUnset !== undefined) {
    if (!Array.isArray(rawUnset)) {
      const error = new Error('unset must be an array of config keys.');
      error.status = 400;
      throw error;
    }
    for (const rawKey of rawUnset) {
      const key = String(rawKey).trim().toUpperCase();
      if (!CONFIG_KEYS.has(key)) {
        const error = new Error(`Unsupported Smart Search config key: ${key}`);
        error.status = 400;
        throw error;
      }
      unset.push(key);
    }
  }

  return {
    set,
    unset: [...new Set(unset)],
  };
};

export const buildSmartSearchConfigResponse = ({ pathInfo, fileValues, env = process.env }) => {
  const values = {};
  for (const key of SMART_SEARCH_CONFIG_KEYS) {
    const envValue = env[key];
    const hasEnvValue = envValue !== undefined;
    const hasFileValue = Object.prototype.hasOwnProperty.call(fileValues, key) && fileValues[key] !== undefined && fileValues[key] !== null;
    const rawValue = hasEnvValue ? String(envValue) : (hasFileValue ? String(fileValues[key]) : '');
    const secret = isSmartSearchSecretKey(key);
    values[key] = {
      key,
      isSet: hasEnvValue || hasFileValue,
      value: secret ? undefined : rawValue,
      maskedValue: secret && rawValue ? maskSmartSearchSecret(rawValue) : undefined,
      secret,
      source: hasEnvValue ? 'environment' : (hasFileValue ? 'config_file' : 'default'),
      editable: !hasEnvValue,
    };
  }

  return {
    ok: true,
    path: pathInfo,
    values,
  };
};
