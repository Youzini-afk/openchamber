import { describe, expect, test } from 'bun:test';
import { shouldResetDesktopMainTabToChat } from './mainTabGuards';

describe('desktop main tab guard', () => {
  test('keeps Files open on desktop so sidebar file open actions can reveal the editor', () => {
    expect(shouldResetDesktopMainTabToChat('files', false)).toBe(false);
  });

  test('keeps mobile tabs under the mobile tab system', () => {
    expect(shouldResetDesktopMainTabToChat('git', true)).toBe(false);
  });

  test('still resets desktop tabs that are not exposed in the desktop header', () => {
    expect(shouldResetDesktopMainTabToChat('git', false)).toBe(true);
    expect(shouldResetDesktopMainTabToChat('terminal', false)).toBe(true);
    expect(shouldResetDesktopMainTabToChat('diff', false)).toBe(true);
    expect(shouldResetDesktopMainTabToChat('context', false)).toBe(true);
  });
});
