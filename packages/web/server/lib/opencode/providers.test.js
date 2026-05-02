import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenCodeConfig = process.env.OPENCODE_CONFIG;

let tempHome;

async function loadProvidersModule() {
  vi.resetModules();
  return import('./providers.js');
}

describe('provider config helpers', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-provider-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.OPENCODE_CONFIG;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalOpenCodeConfig === undefined) {
      delete process.env.OPENCODE_CONFIG;
    } else {
      process.env.OPENCODE_CONFIG = originalOpenCodeConfig;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
    vi.resetModules();
  });

  it('writes an OpenAI-compatible custom provider to the user config', async () => {
    const { upsertProviderConfig } = await loadProvidersModule();

    const result = upsertProviderConfig({
      id: 'my-openai',
      name: 'My OpenAI',
      baseURL: 'https://api.example.com/v1',
      models: [{ id: 'gpt-4o', name: 'GPT 4o' }],
    });

    const configPath = path.join(tempHome, '.config', 'opencode', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(result).toEqual({
      providerId: 'my-openai',
      scope: 'user',
      path: configPath,
    });
    expect(config.provider['my-openai']).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'My OpenAI',
      options: {
        baseURL: 'https://api.example.com/v1',
      },
      models: {
        'gpt-4o': {
          name: 'GPT 4o',
        },
      },
    });
  });

  it('preserves existing providers while adding multiple models', async () => {
    const configPath = path.join(tempHome, '.config', 'opencode', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      provider: {
        existing: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Existing',
          options: { baseURL: 'https://existing.example.com/v1' },
          models: { old: { name: 'Old' } },
        },
      },
    }, null, 2));

    const { upsertProviderConfig } = await loadProvidersModule();

    upsertProviderConfig({
      id: 'deepseek-compatible',
      name: 'DeepSeek Compatible',
      baseURL: 'https://api.deepseek.com',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner' },
      ],
    });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.provider.existing.name).toBe('Existing');
    expect(config.provider['deepseek-compatible'].models).toEqual({
      'deepseek-chat': { name: 'DeepSeek Chat' },
      'deepseek-reasoner': {},
    });
  });
});
