const MODE_NATIVE = 'native';
const MODE_SLIM = 'slim';
const MODE_OMO = 'omo';

const PROVIDER_SLIM = 'oh-my-opencode-slim';
const PROVIDER_OMO = 'oh-my-openagent';

const AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: PROVIDER_SLIM,
    legacyMode: MODE_SLIM,
    title: 'Oh My OpenCode Slim',
    defaultSpec: 'oh-my-opencode-slim',
    packageNames: Object.freeze(['oh-my-opencode-slim']),
    aliases: Object.freeze([]),
    expectedAgentName: 'orchestrator',
    managementSurfaceId: 'slim-agent-provider-settings',
    tui: Object.freeze({
      enabledWhenActive: true,
      defaultSpec: 'oh-my-opencode-slim',
    }),
  }),
  Object.freeze({
    id: PROVIDER_OMO,
    legacyMode: MODE_OMO,
    title: 'Oh My OpenAgent',
    defaultSpec: 'oh-my-openagent',
    packageNames: Object.freeze(['oh-my-openagent']),
    aliases: Object.freeze(['oh-my-opencode']),
    expectedAgentName: 'sisyphus',
    managementSurfaceId: 'openagent-agent-provider-settings',
  }),
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPluginBasename(spec) {
  const normalized = normalizeString(spec).replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function matchesPackageOrAlias(spec, descriptor) {
  const basename = getPluginBasename(spec);
  const names = [...descriptor.packageNames, ...(descriptor.aliases ?? [])];
  return names.some((name) => basename === name || basename.startsWith(`${name}@`));
}

function getAgentOrchestrationProviderForSpec(spec) {
  return AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS.find((descriptor) => matchesPackageOrAlias(spec, descriptor)) ?? null;
}

function getAgentOrchestrationProviderById(providerId) {
  return AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.id === providerId) ?? null;
}

function getAgentOrchestrationProviderByLegacyMode(mode) {
  return AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.legacyMode === mode) ?? null;
}

function getLegacyModeForProviderId(providerId) {
  return getAgentOrchestrationProviderById(providerId)?.legacyMode ?? null;
}

function getProviderIdForLegacyMode(mode) {
  if (mode === MODE_NATIVE) return null;
  return getAgentOrchestrationProviderByLegacyMode(mode)?.id ?? null;
}

function getDefaultSpecForLegacyMode(mode, { surface = 'opencode' } = {}) {
  const descriptor = getAgentOrchestrationProviderByLegacyMode(mode);
  if (!descriptor) return null;
  if (surface === 'tui') return descriptor.tui?.defaultSpec ?? null;
  return descriptor.defaultSpec ?? null;
}

function legacyModeUsesTui(mode) {
  return getAgentOrchestrationProviderByLegacyMode(mode)?.tui?.enabledWhenActive === true;
}

function getExpectedAgentNameForLegacyMode(mode) {
  if (mode === MODE_NATIVE) return 'build';
  return getAgentOrchestrationProviderByLegacyMode(mode)?.expectedAgentName ?? null;
}

export {
  AGENT_ORCHESTRATION_PROVIDER_DESCRIPTORS,
  MODE_NATIVE,
  MODE_SLIM,
  MODE_OMO,
  PROVIDER_OMO,
  PROVIDER_SLIM,
  getAgentOrchestrationProviderById,
  getAgentOrchestrationProviderByLegacyMode,
  getAgentOrchestrationProviderForSpec,
  getDefaultSpecForLegacyMode,
  getExpectedAgentNameForLegacyMode,
  getLegacyModeForProviderId,
  getProviderIdForLegacyMode,
  legacyModeUsesTui,
};
