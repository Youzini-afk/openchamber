import { describe, expect, test } from 'bun:test';

import {
  readEmbeddedSessionChatConfigFromSearch,
  shouldConsumeSessionUrlParams,
} from './embeddedSessionChat';

describe('embedded session chat URL helpers', () => {
  test('parses embedded session chat config from ocPanel URL params', () => {
    const config = readEmbeddedSessionChatConfigFromSearch('?ocPanel=session-chat&sessionId=child-123&directory=%2Ftmp%2Fproject&readOnly=1');

    expect(config).toEqual({
      sessionId: 'child-123',
      directory: '/tmp/project',
      readOnly: true,
    });
  });

  test('does not let generic session URL cleanup consume embedded session chat params', () => {
    const params = new URLSearchParams('?ocPanel=session-chat&sessionId=child-123&directory=%2Ftmp%2Fproject&readOnly=1');

    expect(shouldConsumeSessionUrlParams(params)).toBe(false);
  });

  test('still consumes normal session deep-link params', () => {
    expect(shouldConsumeSessionUrlParams(new URLSearchParams('?sessionId=session-123&directory=%2Ftmp%2Fproject'))).toBe(true);
    expect(shouldConsumeSessionUrlParams(new URLSearchParams('?session=session-123'))).toBe(true);
  });
});
