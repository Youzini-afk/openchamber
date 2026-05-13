import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

let tempHome;

async function loadMagicContextModule() {
  return import(`./magic-context-config.js?test=${Date.now()}-${Math.random()}`);
}

function readJsoncObject(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const withoutComments = content
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(withoutComments);
}

describe('magic-context config helpers', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-magic-context-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalOpenCodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  });

  it('resolves the default user-level magic-context JSONC path when no config exists', async () => {
    const { readMagicContextConfig } = await loadMagicContextModule();

    const result = readMagicContextConfig();

    expect(result.target).toMatchObject({
      scope: 'user',
      path: path.join(tempHome, '.config', 'opencode', 'magic-context.jsonc'),
      exists: false,
      format: 'jsonc',
    });
    expect(result.raw).toEqual({});
  });

  it('creates new config with the canonical schema url', async () => {
    const { saveMagicContextConfig } = await loadMagicContextModule();

    const result = saveMagicContextConfig({
      expectedMtimeMs: null,
      config: { enabled: true },
    });

    const parsed = readJsoncObject(result.target.path);
    expect(parsed.$schema).toBe('https://raw.githubusercontent.com/cortexkit/magic-context/master/assets/magic-context.schema.json');
    expect(parsed.enabled).toBe(true);
  });

  it('canonicalizes legacy schema urls when saving', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'magic-context.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      $schema: 'https://raw.githubusercontent.com/cortexkit/opencode-magic-context/master/assets/magic-context.schema.json',
    }, null, 2));

    const { readMagicContextConfig, saveMagicContextConfig } = await loadMagicContextModule();
    const before = readMagicContextConfig();
    saveMagicContextConfig({
      expectedMtimeMs: before.target.mtimeMs,
      config: {
        $schema: before.raw.$schema,
        enabled: true,
      },
    });

    const parsed = readJsoncObject(configPath);
    expect(parsed.$schema).toBe('https://raw.githubusercontent.com/cortexkit/magic-context/master/assets/magic-context.schema.json');
  });

  it('reads JSONC config and preserves comments and unrelated future fields when saving known fields', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'magic-context.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, [
      '{',
      '  // keep this comment',
      '  "future_field": { "keep": true },',
      '  "enabled": false,',
      '  "historian": { "model": "openai/old", "maxTokens": 4096 }',
      '}',
      '',
    ].join('\n'));

    const { readMagicContextConfig, saveMagicContextConfig } = await loadMagicContextModule();
    const before = readMagicContextConfig();

    saveMagicContextConfig({
      expectedMtimeMs: before.target.mtimeMs,
      config: {
        enabled: true,
        cache_ttl: { default: '5m', 'anthropic/claude-opus-4-6': '60m' },
        execute_threshold_percentage: '',
        system_prompt_injection: {
          enabled: false,
          skip_signatures: [' magic-context ', '', 'custom-signature'],
          future_skip_mode: true,
        },
        historian: { model: '', maxTokens: '', fallback_models: [] },
        dreamer: {
          enabled: true,
          model: 'github-copilot/claude-sonnet-4-6',
          tasks: ['consolidate', 'verify', 'bad-task'],
        },
      },
    });

    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = readJsoncObject(configPath);

    expect(content).toContain('// keep this comment');
    expect(parsed.future_field).toEqual({ keep: true });
    expect(parsed.enabled).toBe(true);
    expect(parsed.cache_ttl).toEqual({
      default: '5m',
      'anthropic/claude-opus-4-6': '60m',
    });
    expect(parsed).not.toHaveProperty('execute_threshold_percentage');
    expect(parsed).not.toHaveProperty('historian');
    expect(parsed.system_prompt_injection).toEqual({
      future_skip_mode: true,
      enabled: false,
      skip_signatures: ['magic-context', 'custom-signature'],
    });
    expect(parsed.dreamer).toEqual({
      enabled: true,
      model: 'github-copilot/claude-sonnet-4-6',
      tasks: ['consolidate', 'verify'],
    });
  });

  it('stores Magic Context fallback models as strings while preserving nested future fields', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'magic-context.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{ "enabled": true }\n');

    const { readMagicContextConfig, saveMagicContextConfig } = await loadMagicContextModule();
    const before = readMagicContextConfig();

    saveMagicContextConfig({
      expectedMtimeMs: before.target.mtimeMs,
      config: {
        historian: {
          model: 'openai/gpt-5.5',
          thinking_level: 'high',
          fallback_models: [
            'anthropic/claude-sonnet-4-6',
            { model: 'google/gemini-3-pro', variant: 'high', maxTokens: 4000 },
          ],
          future_agent_field: { keep: true },
        },
        dreamer: {
          user_memories: {
            enabled: true,
            promotion_threshold: 5,
            legacy_experimental_field: 'keep',
          },
        },
        experimental: {
          temporal_awareness: true,
          future_experimental: 'keep',
          git_commit_indexing: {
            enabled: true,
            since_days: 30,
            legacy_nested: true,
          },
        },
      },
    });

    const parsed = readJsoncObject(configPath);
    expect(parsed.historian).toEqual({
      future_agent_field: { keep: true },
      model: 'openai/gpt-5.5',
      thinking_level: 'high',
      fallback_models: ['anthropic/claude-sonnet-4-6', 'google/gemini-3-pro'],
    });
    expect(parsed.dreamer.user_memories).toEqual({
      legacy_experimental_field: 'keep',
      enabled: true,
      promotion_threshold: 5,
    });
    expect(parsed.experimental).toEqual({
      future_experimental: 'keep',
      temporal_awareness: true,
      git_commit_indexing: {
        legacy_nested: true,
        enabled: true,
        since_days: 30,
      },
    });
  });

  it('detects the Youzini Magic Context fork package as a valid plugin entry', async () => {
    const userConfigDir = path.join(tempHome, '.config', 'opencode');
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.writeFileSync(path.join(userConfigDir, 'opencode.jsonc'), JSON.stringify({
      plugin: ['@youzini/opencode-magic-context@0.18.0-youzini.0'],
    }, null, 2));
    fs.writeFileSync(path.join(userConfigDir, 'tui.jsonc'), JSON.stringify({
      plugin: ['@youzini/opencode-magic-context'],
    }, null, 2));

    const { readMagicContextConfig } = await loadMagicContextModule();

    const result = readMagicContextConfig();

    expect(result.plugin).toMatchObject({
      detected: true,
      entry: '@youzini/opencode-magic-context@0.18.0-youzini.0',
      configPath: path.join(userConfigDir, 'opencode.jsonc'),
    });
    expect(result.diagnostics.tui).toMatchObject({
      detected: true,
      entry: '@youzini/opencode-magic-context',
      configPath: path.join(userConfigDir, 'tui.jsonc'),
    });
  });

  it('reports project-level magic-context overrides without using them as the write target', async () => {
    const projectDir = path.join(tempHome, 'project');
    const projectConfigPath = path.join(projectDir, 'magic-context.jsonc');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(projectConfigPath, JSON.stringify({
      enabled: false,
      auto_update: false,
      memory: { enabled: false },
    }, null, 2));
    const userConfigDir = path.join(tempHome, '.config', 'opencode');
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.writeFileSync(path.join(userConfigDir, 'opencode.jsonc'), JSON.stringify({
      plugin: ['@cortexkit/opencode-magic-context@latest', 'oh-my-openagent'],
    }, null, 2));
    fs.writeFileSync(path.join(userConfigDir, 'tui.jsonc'), JSON.stringify({
      plugin: ['@cortexkit/opencode-magic-context'],
    }, null, 2));
    fs.writeFileSync(path.join(userConfigDir, 'oh-my-openagent.jsonc'), JSON.stringify({
      disabled_hooks: ['context-window-monitor'],
    }, null, 2));

    const { readMagicContextConfig } = await loadMagicContextModule();

    const result = readMagicContextConfig({ directory: projectDir });

    expect(result.target.path).toBe(path.join(tempHome, '.config', 'opencode', 'magic-context.jsonc'));
    expect(result.project).toEqual({
      path: projectConfigPath,
      exists: true,
      overriddenKeys: ['auto_update', 'enabled', 'memory'],
    });
    expect(result.plugin.detected).toBe(true);
    expect(result.diagnostics.tui.detected).toBe(true);
    expect(result.diagnostics.project.ignoredUserOnlyKeys).toEqual(['auto_update']);
    expect(result.diagnostics.omo.activeConflictingHooks).toEqual([
      'preemptive-compaction',
      'anthropic-context-window-limit-recovery',
    ]);
  });

  it('rejects saves when the config was modified after it was read', async () => {
    const configDir = path.join(tempHome, '.config', 'opencode');
    const configPath = path.join(configDir, 'magic-context.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{ "enabled": true }\n');

    const { readMagicContextConfig, saveMagicContextConfig } = await loadMagicContextModule();
    const before = readMagicContextConfig();
    fs.writeFileSync(configPath, '{ "enabled": false }\n');

    expect(() => saveMagicContextConfig({
      expectedMtimeMs: before.target.mtimeMs,
      config: { enabled: true },
    })).toThrow(/modified outside OpenChamber/);

    expect(readJsoncObject(configPath).enabled).toBe(false);
  });
});
