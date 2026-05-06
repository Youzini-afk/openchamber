import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const originalOpenCodeCacheDir = process.env.OPENCODE_CACHE_DIR;

let tempHome;

async function loadModule() {
  return import(`./agent-orchestration-config.js?test=${Date.now()}-${Math.random()}`);
}

function readJsoncObject(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const withoutComments = content.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(withoutComments);
}

describe('agent orchestration config helpers', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-agent-orchestration-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    process.env.OPENCODE_CONFIG_DIR = path.join(tempHome, '.config', 'opencode');
    process.env.OPENCODE_CACHE_DIR = path.join(tempHome, '.cache', 'opencode');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalOpenCodeConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir;
    if (originalOpenCodeCacheDir === undefined) delete process.env.OPENCODE_CACHE_DIR;
    else process.env.OPENCODE_CACHE_DIR = originalOpenCodeCacheDir;
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  });

  it('detects native, Slim, OMO, and conflict modes', async () => {
    const configDir = process.env.OPENCODE_CONFIG_DIR;
    const opencodePath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });

    const { readAgentOrchestrationConfig } = await loadModule();

    expect(readAgentOrchestrationConfig().mode.effective).toBe('native');

    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-opencode-slim"] }\n');
    expect(readAgentOrchestrationConfig().mode.effective).toBe('slim');

    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-openagent"] }\n');
    expect(readAgentOrchestrationConfig().mode.effective).toBe('omo');

    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-openagent", "oh-my-opencode-slim"] }\n');
    expect(readAgentOrchestrationConfig().mode.effective).toBe('conflict');
  });

  it('switches Slim mode by removing OMO entries and writing OpenCode plus TUI configs', async () => {
    const configDir = process.env.OPENCODE_CONFIG_DIR;
    const opencodePath = path.join(configDir, 'opencode.jsonc');
    const tuiPath = path.join(configDir, 'tui.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(opencodePath, [
      '{',
      '  // keep opencode comment',
      '  "plugin": ["other-plugin", "oh-my-openagent"]',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(tuiPath, '{ "plugin": ["other-tui-plugin"] }\n');

    const { readAgentOrchestrationConfig, setAgentOrchestrationMode } = await loadModule();
    const before = readAgentOrchestrationConfig();

    const after = setAgentOrchestrationMode({
      mode: 'slim',
      expectedMtimeMsByPath: before.mode.mtimeMsByPath,
    });

    expect(after.mode.effective).toBe('slim');
    expect(fs.readFileSync(opencodePath, 'utf8')).toContain('// keep opencode comment');
    expect(readJsoncObject(opencodePath).plugin).toEqual(['other-plugin', 'oh-my-opencode-slim']);
    expect(readJsoncObject(tuiPath).plugin).toEqual(['other-tui-plugin', 'oh-my-opencode-slim']);
  });

  it('switches OMO mode by removing Slim from OpenCode and TUI configs', async () => {
    const configDir = process.env.OPENCODE_CONFIG_DIR;
    const opencodePath = path.join(configDir, 'opencode.jsonc');
    const tuiPath = path.join(configDir, 'tui.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-opencode-slim", "other-plugin"] }\n');
    fs.writeFileSync(tuiPath, '{ "plugin": ["oh-my-opencode-slim", "other-tui-plugin"] }\n');

    const { readAgentOrchestrationConfig, setAgentOrchestrationMode } = await loadModule();
    const before = readAgentOrchestrationConfig();

    const after = setAgentOrchestrationMode({
      mode: 'omo',
      expectedMtimeMsByPath: before.mode.mtimeMsByPath,
    });

    expect(after.mode.effective).toBe('omo');
    expect(readJsoncObject(opencodePath).plugin).toEqual(['other-plugin', 'oh-my-openagent']);
    expect(readJsoncObject(tuiPath).plugin).toEqual(['other-tui-plugin']);
  });

  it('rejects mode switches when a written config changed after it was read', async () => {
    const configDir = process.env.OPENCODE_CONFIG_DIR;
    const opencodePath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-openagent"] }\n');

    const { readAgentOrchestrationConfig, setAgentOrchestrationMode } = await loadModule();
    const before = readAgentOrchestrationConfig();
    fs.writeFileSync(opencodePath, '{ "plugin": ["oh-my-openagent", "external-plugin"] }\n');

    expect(() => setAgentOrchestrationMode({
      mode: 'native',
      expectedMtimeMsByPath: before.mode.mtimeMsByPath,
    })).toThrow(/modified outside OpenChamber/);

    expect(readJsoncObject(opencodePath).plugin).toEqual(['oh-my-openagent', 'external-plugin']);
  });
});
