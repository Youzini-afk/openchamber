export {
  AGENT_DIR,
  COMMAND_DIR,
  SKILL_DIR,
  CONFIG_FILE,
  AGENT_SCOPE,
  COMMAND_SCOPE,
  SKILL_SCOPE,
  readConfig,
  writeConfig,
  readSkillSupportingFile,
  writeSkillSupportingFile,
  deleteSkillSupportingFile,
} from './shared.js';

export {
  getAgentScope,
  getAgentPermissionSource,
  getAgentSources,
  getAgentConfig,
  createAgent,
  updateAgent,
  deleteAgent,
} from './agents.js';

export {
  getCommandScope,
  getCommandSources,
  createCommand,
  updateCommand,
  deleteCommand,
} from './commands.js';

export {
  getSkillSources,
  getSkillScope,
  discoverSkills,
  createSkill,
  updateSkill,
  deleteSkill,
} from './skills.js';

export {
  getProviderSources,
  getProviderConfig,
  upsertProviderConfig,
  removeProviderConfig,
  fetchProviderModels,
} from './providers.js';

export {
  readOpenAgentConfig,
  saveOpenAgentConfig,
  setOpenAgentPluginEnabled,
  sanitizeOverride as sanitizeOpenAgentOverride,
  sanitizeOverrideRecord as sanitizeOpenAgentOverrideRecord,
} from './openagent-config.js';

export {
  readAgentOrchestrationConfig,
  setAgentOrchestrationMode,
} from './agent-orchestration-config.js';

export {
  readSlimConfig,
  saveSlimConfig,
  sanitizeSlimConfig,
  ensureSlimStarterConfig,
} from './slim-config.js';

export {
  readMagicContextConfig,
  saveMagicContextConfig,
  sanitizeMagicContextConfig,
} from './magic-context-config.js';

export {
  readAuthFile,
  writeAuthFile,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  AUTH_FILE,
  OPENCODE_DATA_DIR,
} from './auth.js';

export { createUiAuth } from '../ui-auth/ui-auth.js';

export {
  listMcpConfigs,
  getMcpConfig,
  createMcpConfig,
  updateMcpConfig,
  deleteMcpConfig,
} from './mcp.js';
