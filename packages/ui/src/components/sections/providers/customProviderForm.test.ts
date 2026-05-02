import { describe, expect, test } from 'bun:test';

import { normalizeCustomProviderModelRows, resolveCustomProviderApiKey } from './customProviderForm';

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
      { id: 'empty-limits' },
      { id: 'bad-limits', name: 'Bad Limits' },
    ]);
  });
});
