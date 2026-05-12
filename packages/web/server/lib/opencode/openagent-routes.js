import {
  readOpenAgentConfig as defaultReadOpenAgentConfig,
  saveOpenAgentConfig as defaultSaveOpenAgentConfig,
  setOpenAgentPluginEnabled as defaultSetOpenAgentPluginEnabled,
} from './openagent-config.js';

function getRequestedDirectory(req) {
  const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
  const queryDirectory = Array.isArray(req.query?.directory)
    ? req.query.directory[0]
    : req.query?.directory;
  return headerDirectory || queryDirectory || null;
}

async function resolveDirectory(req, resolveOptionalProjectDirectory) {
  const requestedDirectory = getRequestedDirectory(req);
  if (!requestedDirectory) {
    return { directory: null, error: null };
  }

  if (typeof resolveOptionalProjectDirectory === 'function') {
    return resolveOptionalProjectDirectory(req);
  }

  return { directory: requestedDirectory, error: null };
}

export const registerOpenAgentRoutes = (app, dependencies = {}) => {
  const {
    clientReloadDelayMs = 800,
    readOpenAgentConfig = defaultReadOpenAgentConfig,
    saveOpenAgentConfig = defaultSaveOpenAgentConfig,
    setOpenAgentPluginEnabled = defaultSetOpenAgentPluginEnabled,
    refreshOpenCodeAfterConfigChange,
    resolveOptionalProjectDirectory,
  } = dependencies;

  app.get('/api/openagent/config', async (req, res) => {
    try {
      const { directory, error } = await resolveDirectory(req, resolveOptionalProjectDirectory);
      if (error) {
        return res.status(400).json({ error });
      }

      return res.json(readOpenAgentConfig({ directory }));
    } catch (error) {
      console.error('Failed to read oh-my-openagent config:', error);
      return res.status(500).json({ error: error.message || 'Failed to read oh-my-openagent config' });
    }
  });

  app.patch('/api/openagent/config', async (req, res) => {
    try {
      const body = req.body ?? {};
      saveOpenAgentConfig({
        expectedMtimeMs: body.expectedMtimeMs ?? null,
        agents: body.agents ?? {},
        categories: body.categories ?? {},
        disabled_hooks: body.disabled_hooks ?? [],
      });

      if (typeof refreshOpenCodeAfterConfigChange === 'function') {
        await refreshOpenCodeAfterConfigChange('oh-my-openagent config updated');
      }

      const { directory, error } = await resolveDirectory(req, resolveOptionalProjectDirectory);
      if (error) {
        return res.status(400).json({ error });
      }

      return res.json({
        success: true,
        requiresReload: true,
        message: 'Oh My OpenAgent configuration saved. Refreshing interface...',
        reloadDelayMs: clientReloadDelayMs,
        config: readOpenAgentConfig({ directory }),
      });
    } catch (error) {
      const status = error?.code === 'CONFIG_MODIFIED' ? 409 : 400;
      if (status !== 409) {
        console.error('Failed to save oh-my-openagent config:', error);
      }
      return res.status(status).json({ error: error.message || 'Failed to save oh-my-openagent config' });
    }
  });

  app.patch('/api/openagent/plugin', async (req, res) => {
    try {
      const { directory, error } = await resolveDirectory(req, resolveOptionalProjectDirectory);
      if (error) {
        return res.status(400).json({ error });
      }

      const body = req.body ?? {};
      setOpenAgentPluginEnabled({
        directory,
        enabled: body.enabled === true,
        expectedMtimeMs: body.expectedMtimeMs ?? null,
        entry: body.entry,
      });

      if (typeof refreshOpenCodeAfterConfigChange === 'function') {
        await refreshOpenCodeAfterConfigChange(
          body.enabled === true ? 'oh-my-openagent plugin enabled' : 'oh-my-openagent plugin disabled',
        );
      }

      return res.json({
        success: true,
        requiresReload: true,
        message: body.enabled === true
          ? 'Oh My OpenAgent plugin enabled. Refreshing interface...'
          : 'Oh My OpenAgent plugin disabled. Refreshing interface...',
        reloadDelayMs: clientReloadDelayMs,
        config: readOpenAgentConfig({ directory }),
      });
    } catch (error) {
      const status = error?.code === 'CONFIG_MODIFIED' ? 409 : 400;
      if (status !== 409) {
        console.error('Failed to update oh-my-openagent plugin registration:', error);
      }
      return res.status(status).json({ error: error.message || 'Failed to update oh-my-openagent plugin registration' });
    }
  });
};
