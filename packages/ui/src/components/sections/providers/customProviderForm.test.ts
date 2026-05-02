import { describe, expect, test } from 'bun:test';

import { resolveCustomProviderApiKey } from './customProviderForm';

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
});
