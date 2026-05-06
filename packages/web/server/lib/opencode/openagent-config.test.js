import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR;

let tempHome;

async function loadOpenAgentModule() {
  return import(`./openagent-config.js?test=${Date.now()}-${Math.random()}`);
}

function readJsoncObject(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const withoutLineComments = content.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(withoutLineComments);
}

describe('oh-my-openagent config helpers', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-openagent-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalOpenCodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  });

  it('resolves the default user-level canonical JSONC path when no config exists', async () => {
    const { readOpenAgentConfig } = await loadOpenAgentModule();

    const result = readOpenAgentConfig();

    expect(result.target).toMatchObject({
      scope: 'user',
      path: path.join(tempHome, '.config', 'opencode', 'oh-my-openagent.jsonc'),
      exists: false,
      format: 'jsonc',
      isLegacy: false,
    });
    expect(result.raw).toEqual({ agents: {}, categories: {} });
  });

  it('reads JSONC config and preserves unrelated fields and comments when saving agents and categories', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'oh-my-openagent.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, [
      '{',
      '  // keep this comment',
      '  "notification": { "force_enable": true },',
      '  "agents": {',
      '    "sisyphus": { "model": "openai/old", "maxTokens": 4096 }',
      '  },',
      '  "categories": {',
      '    "deep": { "model": "openai/old-deep", "maxTokens": 2048 }',
      '  }',
      '}',
      '',
    ].join('\n'));

    const { readOpenAgentConfig, saveOpenAgentConfig } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();

    saveOpenAgentConfig({
      expectedMtimeMs: before.target.mtimeMs,
      agents: {
        sisyphus: { model: '', maxTokens: '' },
        hephaestus: { model: 'openai/gpt-5.4', fallback_models: [] },
      },
      categories: {
        deep: { model: 'custom/deep-model', maxTokens: '' },
      },
    });

    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = readJsoncObject(configPath);

    expect(content).toContain('// keep this comment');
    expect(parsed.notification).toEqual({ force_enable: true });
    expect(parsed.agents).toEqual({
      hephaestus: { model: 'openai/gpt-5.4' },
    });
    expect(parsed.categories).toEqual({
      deep: { model: 'custom/deep-model' },
    });
  });

  it('edits a legacy oh-my-opencode config file when no canonical config exists', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const legacyPath = path.join(configDir, 'oh-my-opencode.jsonc');
    const canonicalPath = path.join(configDir, 'oh-my-openagent.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(legacyPath, '{\n  "agents": {}\n}\n');

    const { readOpenAgentConfig, saveOpenAgentConfig } = await loadOpenAgentModule();

    const before = readOpenAgentConfig();
    expect(before.target).toMatchObject({
      path: legacyPath,
      isLegacy: true,
      exists: true,
    });

    saveOpenAgentConfig({
      expectedMtimeMs: before.target.mtimeMs,
      agents: { sisyphus: { model: 'openai/gpt-5.5' } },
      categories: {},
    });

    expect(fs.existsSync(canonicalPath)).toBe(false);
    expect(readJsoncObject(legacyPath).agents).toEqual({
      sisyphus: { model: 'openai/gpt-5.5' },
    });
  });

  it('reports project-level overrides without using them as the write target', async () => {
    const projectDir = path.join(tempHome, 'project');
    const projectConfigDir = path.join(projectDir, '.opencode');
    const projectConfigPath = path.join(projectConfigDir, 'oh-my-openagent.jsonc');
    fs.mkdirSync(projectConfigDir, { recursive: true });
    fs.writeFileSync(projectConfigPath, JSON.stringify({
      agents: { oracle: { model: 'anthropic/oracle' } },
      categories: { quick: { model: 'openai/quick' } },
    }, null, 2));

    const { readOpenAgentConfig } = await loadOpenAgentModule();

    const result = readOpenAgentConfig({ directory: projectDir });

    expect(result.target.path).toBe(path.join(tempHome, '.config', 'opencode', 'oh-my-openagent.jsonc'));
    expect(result.project).toEqual({
      path: projectConfigPath,
      exists: true,
      overriddenAgents: ['oracle'],
      overriddenCategories: ['quick'],
    });
  });

  it('toggles the OpenCode plugin registration while preserving other plugins and comments', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const opencodeConfigPath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(opencodeConfigPath, [
      '{',
      '  // keep opencode comment',
      '  "plugin": ["other-plugin", "oh-my-openagent@3.11.0"]',
      '}',
      '',
    ].join('\n'));

    const { readOpenAgentConfig, setOpenAgentPluginEnabled } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();

    expect(before.plugin).toMatchObject({
      detected: true,
      enabled: true,
      entry: 'oh-my-openagent@3.11.0',
      configPath: opencodeConfigPath,
      configKey: 'plugin',
      scope: 'user',
    });

    const disabled = setOpenAgentPluginEnabled({
      expectedMtimeMs: before.plugin.mtimeMs,
      enabled: false,
    });

    let content = fs.readFileSync(opencodeConfigPath, 'utf8');
    let parsed = readJsoncObject(opencodeConfigPath);
    expect(content).toContain('// keep opencode comment');
    expect(parsed.plugin).toEqual(['other-plugin']);
    expect(disabled.plugin.enabled).toBe(false);

    setOpenAgentPluginEnabled({
      expectedMtimeMs: disabled.plugin.mtimeMs,
      enabled: true,
      entry: before.plugin.entry,
    });

    content = fs.readFileSync(opencodeConfigPath, 'utf8');
    parsed = readJsoncObject(opencodeConfigPath);
    expect(content).toContain('// keep opencode comment');
    expect(parsed.plugin).toEqual(['other-plugin', 'oh-my-openagent@3.11.0']);
  });

  it('creates an OpenCode config with the canonical plugin entry when enabling from a disabled state', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const opencodeConfigPath = path.join(configDir, 'opencode.jsonc');

    const { readOpenAgentConfig, setOpenAgentPluginEnabled } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();
    expect(before.plugin.enabled).toBe(false);
    expect(before.plugin.writeTargetPath).toBe(opencodeConfigPath);

    const enabled = setOpenAgentPluginEnabled({
      expectedMtimeMs: before.plugin.mtimeMs,
      enabled: true,
    });

    expect(enabled.plugin.enabled).toBe(true);
    expect(readJsoncObject(opencodeConfigPath).plugin).toEqual(['oh-my-openagent']);
  });

  it('ignores and cleans stale legacy config.json plugin entries when enabling', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const legacyPath = path.join(configDir, 'config.json');
    const opencodeConfigPath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(legacyPath, '{ "plugin": ["oh-my-openagent", "legacy-helper"] }\n');

    const { readOpenAgentConfig, setOpenAgentPluginEnabled } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();

    expect(before.plugin.enabled).toBe(false);
    expect(before.plugin.writeTargetPath).toBe(opencodeConfigPath);

    const enabled = setOpenAgentPluginEnabled({
      expectedMtimeMs: before.plugin.mtimeMs,
      enabled: true,
    });

    expect(enabled.plugin.enabled).toBe(true);
    expect(readJsoncObject(legacyPath).plugin).toEqual(['legacy-helper']);
    expect(readJsoncObject(opencodeConfigPath).plugin).toEqual(['oh-my-openagent']);
  });

  it('rejects saves when the config was modified after it was read', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'oh-my-openagent.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{ "agents": {} }\n');

    const { readOpenAgentConfig, saveOpenAgentConfig } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();
    fs.writeFileSync(configPath, '{ "agents": { "sisyphus": { "model": "external/change" } } }\n');

    expect(() => saveOpenAgentConfig({
      expectedMtimeMs: before.target.mtimeMs,
      agents: { sisyphus: { model: 'openai/gpt-5.5' } },
      categories: {},
    })).toThrow(/modified outside OpenChamber/);

    expect(readJsoncObject(configPath).agents).toEqual({
      sisyphus: { model: 'external/change' },
    });
  });

  it('rejects plugin toggles when the OpenCode config changed after it was read', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const opencodeConfigPath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(opencodeConfigPath, '{ "plugin": ["oh-my-openagent"] }\n');

    const { readOpenAgentConfig, setOpenAgentPluginEnabled } = await loadOpenAgentModule();
    const before = readOpenAgentConfig();
    fs.writeFileSync(opencodeConfigPath, '{ "plugin": ["oh-my-openagent", "external-plugin"] }\n');

    expect(() => setOpenAgentPluginEnabled({
      expectedMtimeMs: before.plugin.mtimeMs,
      enabled: false,
    })).toThrow(/modified outside OpenChamber/);

    expect(readJsoncObject(opencodeConfigPath).plugin).toEqual(['oh-my-openagent', 'external-plugin']);
  });
});
