import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR;

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
    expect(parsed.dreamer).toEqual({
      enabled: true,
      model: 'github-copilot/claude-sonnet-4-6',
      tasks: ['consolidate', 'verify'],
    });
  });

  it('reports project-level magic-context overrides without using them as the write target', async () => {
    const projectDir = path.join(tempHome, 'project');
    const projectConfigPath = path.join(projectDir, 'magic-context.jsonc');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(projectConfigPath, JSON.stringify({
      enabled: false,
      memory: { enabled: false },
    }, null, 2));

    const { readMagicContextConfig } = await loadMagicContextModule();

    const result = readMagicContextConfig({ directory: projectDir });

    expect(result.target.path).toBe(path.join(tempHome, '.config', 'opencode', 'magic-context.jsonc'));
    expect(result.project).toEqual({
      path: projectConfigPath,
      exists: true,
      overriddenKeys: ['enabled', 'memory'],
    });
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
