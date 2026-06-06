import { describe, expect, test } from 'bun:test';

import {
  buildOpenAgentSavePayload,
  createOpenAgentDraftFromConfig,
  fallbackModelsToRows,
  fallbackRowsToConfig,
  hasOpenAgentDraftChanges,
  normalizeOpenAgentRecord,
} from './openAgentConfig';

describe('openAgentConfig helpers', () => {
  test('normalizes empty fields out of saved agent overrides', () => {
    expect(normalizeOpenAgentRecord('agent', {
      sisyphus: {
        model: ' ',
        maxTokens: '',
        fallback_models: [],
        temperature: '3',
        top_p: '2',
        reasoningEffort: 'huge',
      },
      hephaestus: {
        model: ' openai/gpt-5.4 ',
        maxTokens: '8192',
        temperature: '1.2',
        top_p: '0.9',
        disable: true,
      },
    })).toEqual({
      hephaestus: {
        model: 'openai/gpt-5.4',
        maxTokens: 8192,
        temperature: 1.2,
        top_p: 0.9,
        disable: true,
      },
    });
  });

  test('preserves fallback model strings and object settings through row editing', () => {
    const rows = fallbackModelsToRows([
      'openai/gpt-5.4',
      {
        model: 'anthropic/claude-opus-4-7',
        variant: 'max',
        maxTokens: 4096,
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'fallback-0',
        model: 'openai/gpt-5.4',
        variant: '',
        maxTokens: '',
        reasoningEffort: '',
        originalType: 'string',
      },
      {
        id: 'fallback-1',
        model: 'anthropic/claude-opus-4-7',
        variant: 'max',
        maxTokens: '4096',
        reasoningEffort: '',
        originalType: 'object',
      },
    ]);
    expect(fallbackRowsToConfig(rows)).toEqual([
      'openai/gpt-5.4',
      {
        model: 'anthropic/claude-opus-4-7',
        variant: 'max',
        maxTokens: 4096,
      },
    ]);
  });

  test('preserves advanced fallback object settings through row editing', () => {
    const rows = fallbackModelsToRows([
      {
        model: 'openai/gpt-5.5',
        temperature: 0.4,
        top_p: 0.8,
        thinking: { type: 'enabled', budgetTokens: 4096 },
      },
    ]);

    expect(fallbackRowsToConfig(rows)).toEqual([
      {
        model: 'openai/gpt-5.5',
        temperature: 0.4,
        top_p: 0.8,
        thinking: { type: 'enabled', budgetTokens: 4096 },
      },
    ]);
  });

  test('creates drafts from user raw config only and leaves project overrides out of the save payload', () => {
    const draft = createOpenAgentDraftFromConfig({
      raw: {
        agents: {},
        categories: {
          deep: { model: 'openai/gpt-5.5' },
        },
        disabled_hooks: ['todo-continuation-enforcer'],
        disabled_providers: ['anthropic', 'openai'],
        default_mode: 'ultrawork',
        hashline_edit: false,
        model_fallback: false,
        runtime_fallback: false,
        team_mode: { enabled: true, max_parallel_members: 4 },
      },
      project: {
        overriddenAgents: ['oracle'],
        overriddenCategories: ['quick'],
      },
    });

    expect(draft).toEqual({
      agents: {},
      categories: {
        deep: { model: 'openai/gpt-5.5' },
      },
      disabled_hooks: ['todo-continuation-enforcer'],
      disabled_providers: ['anthropic', 'openai'],
      default_mode: 'ultrawork',
      hashline_edit: false,
      model_fallback: false,
      runtime_fallback: false,
      team_mode: { enabled: true, max_parallel_members: 4 },
    });

    expect(buildOpenAgentSavePayload(123, draft)).toEqual({
      expectedMtimeMs: 123,
      agents: {},
      categories: {
        deep: { model: 'openai/gpt-5.5' },
      },
      disabled_hooks: ['todo-continuation-enforcer'],
      disabled_providers: ['anthropic', 'openai'],
      default_mode: 'ultrawork',
      hashline_edit: false,
      model_fallback: false,
      runtime_fallback: false,
      team_mode: { enabled: true, max_parallel_members: 4 },
    });
  });

  test('compares drafts with stable key ordering', () => {
    expect(hasOpenAgentDraftChanges(
      {
        agents: {
          sisyphus: { model: 'openai/gpt-5.5', temperature: 1 },
        },
        categories: {},
        disabled_hooks: [],
      },
      {
        agents: {
          sisyphus: { temperature: 1, model: 'openai/gpt-5.5' },
        },
        categories: {},
        disabled_hooks: [],
      },
    )).toBe(false);
  });
});
