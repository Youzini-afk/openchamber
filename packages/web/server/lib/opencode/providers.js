import {
  CONFIG_FILE,
  readConfigLayers,
  isPlainObject,
  getConfigForPath,
  writeConfig,
} from './shared.js';

const DEFAULT_OPENAI_COMPATIBLE_NPM = '@ai-sdk/openai-compatible';
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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
  const name = normalizeNonEmptyString(input.name) || providerId;
  const npm = normalizeNonEmptyString(input.npm) || DEFAULT_OPENAI_COMPATIBLE_NPM;
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
};
