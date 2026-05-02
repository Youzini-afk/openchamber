import {
  CONFIG_FILE,
  readConfigLayers,
  isPlainObject,
  getConfigForPath,
  writeConfig,
} from './shared.js';

const DEFAULT_OPENAI_COMPATIBLE_NPM = '@ai-sdk/openai-compatible';
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DEFAULT_CUSTOM_PROVIDER_TYPE = 'openai-compatible';
const ANTHROPIC_API_VERSION = '2023-06-01';

const CUSTOM_PROVIDER_TYPES = Object.freeze({
  'openai-compatible': {
    npm: DEFAULT_OPENAI_COMPATIBLE_NPM,
    defaultBaseURL: '',
  },
  'openai-responses': {
    npm: '@ai-sdk/openai',
    defaultBaseURL: 'https://api.openai.com/v1',
  },
  anthropic: {
    npm: '@ai-sdk/anthropic',
    defaultBaseURL: 'https://api.anthropic.com/v1',
  },
  google: {
    npm: '@ai-sdk/google',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
  },
});

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeProviderId(value) {
  const id = normalizeNonEmptyString(value);
  if (!id) {
    throw new Error('Provider ID is required');
  }
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error('Provider ID can only contain letters, numbers, dots, underscores, and hyphens');
  }
  return id;
}

function normalizeProviderType(input) {
  const type = normalizeNonEmptyString(
    input?.type ?? input?.apiType ?? input?.providerType ?? input?.format,
  ) || DEFAULT_CUSTOM_PROVIDER_TYPE;

  if (!Object.prototype.hasOwnProperty.call(CUSTOM_PROVIDER_TYPES, type)) {
    throw new Error(`Unsupported custom provider API type: ${type}`);
  }

  return type;
}

function normalizeModels(models) {
  if (!Array.isArray(models)) {
    throw new Error('At least one model is required');
  }

  const normalized = {};
  for (const entry of models) {
    const modelId = isPlainObject(entry)
      ? normalizeNonEmptyString(entry.id)
      : normalizeNonEmptyString(entry);

    if (!modelId) {
      continue;
    }

    const modelName = isPlainObject(entry) ? normalizeNonEmptyString(entry.name) : '';
    normalized[modelId] = modelName ? { name: modelName } : {};
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('At least one model is required');
  }

  return normalized;
}

function buildProviderEntry(input) {
  if (!isPlainObject(input)) {
    throw new Error('Provider configuration is required');
  }

  const providerId = normalizeProviderId(input.id ?? input.providerId ?? input.providerID);
  const type = normalizeProviderType(input);
  const name = normalizeNonEmptyString(input.name) || providerId;
  const npm = normalizeNonEmptyString(input.npm) || CUSTOM_PROVIDER_TYPES[type].npm;
  const baseURL = normalizeNonEmptyString(input.baseURL ?? input.baseUrl);
  if (!baseURL) {
    throw new Error('Base URL is required');
  }

  return {
    providerId,
    entry: {
      npm,
      name,
      options: {
        baseURL,
      },
      models: normalizeModels(input.models),
    },
  };
}

function normalizeFetchBaseURL(value, providerType) {
  const baseURL = normalizeNonEmptyString(value) || CUSTOM_PROVIDER_TYPES[providerType]?.defaultBaseURL || '';
  if (!baseURL) {
    throw new Error('Base URL is required');
  }

  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error('Base URL must be a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must use http or https');
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function appendURLPath(baseURL, path) {
  return `${baseURL}/${path.replace(/^\/+/, '')}`;
}

function buildModelListRequest(providerType, baseURL, apiKey) {
  if (providerType === 'google') {
    const url = new URL(appendURLPath(baseURL, 'models'));
    url.searchParams.set('key', apiKey);
    return {
      url: url.toString(),
      requestOptions: {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
    };
  }

  if (providerType === 'anthropic') {
    return {
      url: appendURLPath(baseURL, 'models'),
      requestOptions: {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'anthropic-version': ANTHROPIC_API_VERSION,
          'x-api-key': apiKey,
        },
      },
    };
  }

  return {
    url: appendURLPath(baseURL, 'models'),
    requestOptions: {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    },
  };
}

function getModelEntries(providerType, payload) {
  if (!isPlainObject(payload)) {
    return [];
  }
  if (providerType === 'google') {
    return Array.isArray(payload.models) ? payload.models : [];
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

function normalizeFetchedModel(providerType, entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  const rawId = providerType === 'google'
    ? normalizeNonEmptyString(entry.name).replace(/^models\//, '')
    : normalizeNonEmptyString(entry.id);

  if (!rawId) {
    return null;
  }

  const displayName = normalizeNonEmptyString(
    entry.displayName ?? entry.display_name ?? entry.title ?? '',
  );

  return {
    id: rawId,
    name: displayName || rawId,
  };
}

function normalizeFetchedModels(providerType, payload) {
  const seen = new Set();
  const models = [];

  for (const entry of getModelEntries(providerType, payload)) {
    const model = normalizeFetchedModel(providerType, entry);
    if (!model || seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    models.push(model);
  }

  if (models.length === 0) {
    throw new Error('No models returned by provider');
  }

  return models;
}

function getProviderErrorMessage(payload) {
  if (!isPlainObject(payload)) {
    return '';
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  if (isPlainObject(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message;
  }

  if (typeof payload.message === 'string') {
    return payload.message;
  }

  return '';
}

async function readJSONResponse(response) {
  if (!response || typeof response.json !== 'function') {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchProviderModels(input, fetchImpl = globalThis.fetch) {
  if (!isPlainObject(input)) {
    throw new Error('Provider model fetch configuration is required');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available');
  }

  const type = normalizeProviderType(input);
  const apiKey = normalizeNonEmptyString(input.apiKey ?? input.key ?? input.token);
  if (!apiKey) {
    throw new Error('API key is required to fetch models');
  }

  const baseURL = normalizeFetchBaseURL(input.baseURL ?? input.baseUrl, type);
  const request = buildModelListRequest(type, baseURL, apiKey);
  const response = await fetchImpl(request.url, request.requestOptions);
  const payload = await readJSONResponse(response);

  if (!response?.ok) {
    const providerMessage = getProviderErrorMessage(payload);
    const status = typeof response?.status === 'number' ? response.status : 'unknown';
    throw new Error(providerMessage || `Failed to fetch models (${status})`);
  }

  return {
    type,
    baseURL,
    models: normalizeFetchedModels(type, payload),
  };
}

function getProviderSources(providerId, workingDirectory) {
  const layers = readConfigLayers(workingDirectory);
  const { userConfig, projectConfig, customConfig, paths } = layers;

  const customProviders = isPlainObject(customConfig?.provider) ? customConfig.provider : {};
  const customProvidersAlias = isPlainObject(customConfig?.providers) ? customConfig.providers : {};
  const projectProviders = isPlainObject(projectConfig?.provider) ? projectConfig.provider : {};
  const projectProvidersAlias = isPlainObject(projectConfig?.providers) ? projectConfig.providers : {};
  const userProviders = isPlainObject(userConfig?.provider) ? userConfig.provider : {};
  const userProvidersAlias = isPlainObject(userConfig?.providers) ? userConfig.providers : {};

  const customExists =
    Object.prototype.hasOwnProperty.call(customProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(customProvidersAlias, providerId);
  const projectExists =
    Object.prototype.hasOwnProperty.call(projectProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(projectProvidersAlias, providerId);
  const userExists =
    Object.prototype.hasOwnProperty.call(userProviders, providerId) ||
    Object.prototype.hasOwnProperty.call(userProvidersAlias, providerId);

  return {
    sources: {
      auth: { exists: false },
      user: { exists: userExists, path: paths.userPath },
      project: { exists: projectExists, path: paths.projectPath || null },
      custom: { exists: customExists, path: paths.customPath }
    }
  };
}

function upsertProviderConfig(input, workingDirectory, scope = 'user') {
  const { providerId, entry } = buildProviderEntry(input);
  const layers = readConfigLayers(workingDirectory);
  let targetPath = layers.paths.userPath;
  let resolvedScope = 'user';

  if (scope === 'project') {
    if (!workingDirectory) {
      throw new Error('Working directory is required for project scope');
    }
    targetPath = layers.paths.projectPath || targetPath;
    resolvedScope = 'project';
  } else if (scope === 'custom') {
    if (!layers.paths.customPath) {
      throw new Error('Custom config path is not configured');
    }
    targetPath = layers.paths.customPath;
    resolvedScope = 'custom';
  } else if (scope !== 'user') {
    throw new Error('Invalid scope');
  }

  const targetConfig = getConfigForPath(layers, targetPath);
  const providerConfig = isPlainObject(targetConfig.provider) ? { ...targetConfig.provider } : {};
  providerConfig[providerId] = entry;
  targetConfig.provider = providerConfig;

  writeConfig(targetConfig, targetPath || CONFIG_FILE);
  console.log(`Saved provider ${providerId} to config: ${targetPath}`);

  return {
    providerId,
    scope: resolvedScope,
    path: targetPath || CONFIG_FILE,
  };
}

function removeProviderConfig(providerId, workingDirectory, scope = 'user') {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const layers = readConfigLayers(workingDirectory);
  let targetPath = layers.paths.userPath;

  if (scope === 'project') {
    if (!workingDirectory) {
      throw new Error('Working directory is required for project scope');
    }
    targetPath = layers.paths.projectPath || targetPath;
  } else if (scope === 'custom') {
    if (!layers.paths.customPath) {
      return false;
    }
    targetPath = layers.paths.customPath;
  }

  const targetConfig = getConfigForPath(layers, targetPath);
  const providerConfig = isPlainObject(targetConfig.provider) ? targetConfig.provider : {};
  const providersConfig = isPlainObject(targetConfig.providers) ? targetConfig.providers : {};
  const removedProvider = Object.prototype.hasOwnProperty.call(providerConfig, providerId);
  const removedProviders = Object.prototype.hasOwnProperty.call(providersConfig, providerId);

  if (!removedProvider && !removedProviders) {
    return false;
  }

  if (removedProvider) {
    delete providerConfig[providerId];
    if (Object.keys(providerConfig).length === 0) {
      delete targetConfig.provider;
    } else {
      targetConfig.provider = providerConfig;
    }
  }

  if (removedProviders) {
    delete providersConfig[providerId];
    if (Object.keys(providersConfig).length === 0) {
      delete targetConfig.providers;
    } else {
      targetConfig.providers = providersConfig;
    }
  }

  writeConfig(targetConfig, targetPath || CONFIG_FILE);
  console.log(`Removed provider ${providerId} from config: ${targetPath}`);
  return true;
}

export {
  getProviderSources,
  upsertProviderConfig,
  removeProviderConfig,
  fetchProviderModels,
};
