import { describe, expect, test } from 'bun:test';

import {
  createCustomProviderFormStateFromConfig,
  hasEditableProviderConfigSource,
  normalizeCustomProviderModelRows,
  resolveCustomProviderApiKey,
} from './customProviderForm';

describe('custom provider form helpers', () => {
  test('uses the controlled API key state when it has a value', () => {
    expect(resolveCustomProviderApiKey(' sk-state ', { value: 'sk-dom' })).toBe('sk-state');
  });

  test('falls back to the input value when browser autofill has not updated state', () => {
    expect(resolveCustomProviderApiKey('', { value: ' sk-autofill ' })).toBe('sk-autofill');
  });

  test('returns an empty string when neither source has an API key', () => {
    expect(resolveCustomProviderApiKey(' ', { value: ' ' })).toBe('');
  });

  test('normalizes model names and token limits for custom provider saving', () => {
    expect(normalizeCustomProviderModelRows([
      { id: ' gpt-test ', name: ' GPT Test ', context: '200000', output: '8192' },
      { id: 'context-only', name: 'Context Only', context: '128000', output: '', attachment: true },
      { id: 'empty-limits', name: '', context: '', output: ' ' },
      { id: 'bad-limits', name: 'Bad Limits', context: '0', output: '-10' },
      { id: 'gpt-test', name: 'Duplicate', context: '128000', output: '4096' },
    ])).toEqual([
      {
        id: 'gpt-test',
        name: 'GPT Test',
        limit: {
          context: 200000,
          output: 8192,
        },
      },
      {
        id: 'context-only',
        name: 'Context Only',
        attachment: true,
        limit: {
          context: 128000,
        },
      },
      { id: 'empty-limits' },
      { id: 'bad-limits', name: 'Bad Limits' },
    ]);
  });

  test('creates editable form state from a saved custom provider config', () => {
    expect(createCustomProviderFormStateFromConfig({
      providerId: 'editable',
      type: 'anthropic',
      name: 'Editable Provider',
      baseURL: 'https://api.example.com/v1',
      scope: 'project',
      models: [
        { id: 'claude-test', name: 'Claude Test', context: 200000, output: 8192, attachment: true },
        { id: 'nameless-model' },
      ],
    })).toEqual({
      type: 'anthropic',
      id: 'editable',
      name: 'Editable Provider',
      baseURL: 'https://api.example.com/v1',
      apiKey: '',
      scope: 'project',
      models: [
        { id: 'claude-test', name: 'Claude Test', context: '200000', output: '8192', attachment: true },
        { id: 'nameless-model', name: '', context: '', output: '', attachment: false },
      ],
    });
  });

  test('preserves custom config scope when editing an env-backed provider', () => {
    expect(createCustomProviderFormStateFromConfig({
      providerId: 'env-backed',
      type: 'openai-compatible',
      name: 'Env Backed',
      baseURL: 'https://api.example.com/v1',
      scope: 'custom',
      models: [{ id: 'model-1' }],
    }).scope).toBe('custom');
  });

  test('detects when a selected provider has editable provider configuration', () => {
    expect(hasEditableProviderConfigSource(undefined)).toBe(false);
    expect(hasEditableProviderConfigSource({
      auth: { exists: true },
      user: { exists: false },
      project: { exists: false },
    })).toBe(false);
    expect(hasEditableProviderConfigSource({
      auth: { exists: false },
      user: { exists: true },
      project: { exists: false },
    })).toBe(true);
    expect(hasEditableProviderConfigSource({
      auth: { exists: false },
      user: { exists: false },
      project: { exists: false },
      custom: { exists: true },
    })).toBe(true);
  });
});
