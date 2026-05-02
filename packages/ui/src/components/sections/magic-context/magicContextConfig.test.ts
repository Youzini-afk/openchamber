import { describe, expect, test } from 'bun:test';

import {
  agentFallbackModelsToRows,
  agentFallbackRowsToConfig,
  buildMagicContextSavePayload,
  createMagicContextDraftFromConfig,
  hasMagicContextDraftChanges,
  normalizeMagicContextConfig,
} from './magicContextConfig';

describe('magicContextConfig helpers', () => {
  test('normalizes empty fields out of saved config', () => {
    expect(normalizeMagicContextConfig({
      enabled: true,
      execute_threshold_percentage: '',
      protected_tags: '0',
      historian: {
        model: ' ',
        maxTokens: '',
        fallback_models: [],
        temperature: '3',
      },
      dreamer: {
        enabled: true,
        model: ' github-copilot/claude-sonnet-4-6 ',
        tasks: ['consolidate', 'bad-task', 'verify'],
      },
    })).toEqual({
      enabled: true,
      dreamer: {
        enabled: true,
        model: 'github-copilot/claude-sonnet-4-6',
        tasks: ['consolidate', 'verify'],
      },
    });
  });

  test('preserves per-model scalar maps', () => {
    expect(normalizeMagicContextConfig({
      cache_ttl: {
        default: '5m',
        'anthropic/claude-opus-4-6': '60m',
        empty: '',
      },
      execute_threshold_percentage: {
        default: 65,
        'github-copilot/gpt-5.2-codex': '40',
        bad: 90,
      },
      execute_threshold_tokens: {
        default: '150000',
        bad: 20,
      },
    })).toEqual({
      cache_ttl: {
        default: '5m',
        'anthropic/claude-opus-4-6': '60m',
      },
      execute_threshold_percentage: {
        default: 65,
        'github-copilot/gpt-5.2-codex': 40,
      },
      execute_threshold_tokens: {
        default: 150000,
      },
    });
  });

  test('preserves fallback model strings and object settings through row editing', () => {
    const rows = agentFallbackModelsToRows([
      'openai/gpt-5.4',
      {
        model: 'anthropic/claude-opus-4-6',
        variant: 'max',
        maxTokens: 4096,
      },
    ]);

    expect(agentFallbackRowsToConfig(rows)).toEqual([
      'openai/gpt-5.4',
      {
        model: 'anthropic/claude-opus-4-6',
        variant: 'max',
        maxTokens: 4096,
      },
    ]);
  });

  test('creates drafts from user raw config only and leaves project overrides out of the save payload', () => {
    const draft = createMagicContextDraftFromConfig({
      raw: {
        enabled: true,
        memory: { enabled: false },
      },
      project: {
        overriddenKeys: ['enabled', 'historian'],
      },
    });

    expect(buildMagicContextSavePayload(123, draft)).toEqual({
      expectedMtimeMs: 123,
      config: {
        enabled: true,
        memory: { enabled: false },
      },
    });
  });

  test('keeps top-level deletion markers in the save payload', () => {
    expect(buildMagicContextSavePayload(123, {
      enabled: true,
      execute_threshold_percentage: '',
      historian: {
        model: '',
        fallback_models: [],
      },
    })).toEqual({
      expectedMtimeMs: 123,
      config: {
        enabled: true,
        execute_threshold_percentage: '',
        historian: {
          model: '',
          fallback_models: [],
        },
      },
    });
  });

  test('compares drafts with stable key ordering', () => {
    expect(hasMagicContextDraftChanges(
      {
        historian: { model: 'openai/gpt-5.4', temperature: 1 },
      },
      {
        historian: { temperature: 1, model: 'openai/gpt-5.4' },
      },
    )).toBe(false);
  });
});
