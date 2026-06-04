import { describe, expect, test } from 'bun:test';
import { SETTINGS_PAGE_METADATA, resolveSettingsSlug } from './metadata';

describe('settings metadata', () => {
  test('keeps Smart Search reachable while hiding it from primary navigation', () => {
    const smartSearch = SETTINGS_PAGE_METADATA.find((page) => page.slug === 'smart-search');

    expect(resolveSettingsSlug('smart-search')).toBe('smart-search');
    expect(smartSearch?.group).toBe('skills');
    expect(smartSearch?.kind).toBe('split');
    expect(smartSearch?.primaryNav).toBe(false);
  });
});
