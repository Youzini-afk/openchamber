import { describe, expect, test } from 'bun:test'

import {
  beginProgressiveMount,
  endProgressiveMount,
  isProgressiveMountInFlight,
  shouldFetchSessionForRenderableSync,
} from './use-sync'

describe('shouldFetchSessionForRenderableSync', () => {
  test('fetches full session detail when a lightweight list session is opened', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: true,
      shouldLoadMessages: true,
      force: false,
    })).toBe(true)
  })

  test('skips session detail fetch when session and messages are already ready', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: true,
      shouldLoadMessages: false,
      force: false,
    })).toBe(false)
  })

  test('fetches when the session record is missing', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: false,
      shouldLoadMessages: false,
      force: false,
    })).toBe(true)
  })
})

describe('isProgressiveMountInFlight', () => {
  test('returns false for sessions with no progressive mount running', () => {
    expect(isProgressiveMountInFlight('ses_nonexistent')).toBe(false)
  })

  test('is queryable without subscribing to the sync store', () => {
    // isProgressiveMountInFlight reads a module-level Map, so it can be called
    // from non-hook consumers (useChatTimelineController) without a React
    // context. It must never throw for any string input.
    let threwEmpty = false;
    try { isProgressiveMountInFlight(''); } catch { threwEmpty = true; }
    expect(threwEmpty).toBe(false)

    let threwSpecial = false;
    try { isProgressiveMountInFlight('ses_with_special_chars_!@#'); } catch { threwSpecial = true; }
    expect(threwSpecial).toBe(false)
  })
})

describe('progressive mount token (Medium risk 5)', () => {
  test('beginProgressiveMount marks the session as in-flight', () => {
    const sessionID = 'ses_token_begin'
    const token = beginProgressiveMount(sessionID)
    try {
      expect(typeof token).toBe('number')
      expect(isProgressiveMountInFlight(sessionID)).toBe(true)
    } finally {
      // Clean up using the SAME token we captured — never create a new one
      // just to derive a "wrong" token for cleanup.
      endProgressiveMount(sessionID, token)
    }
  })

  test('endProgressiveMount with the correct token clears the flag', () => {
    const sessionID = 'ses_token_clear'
    const token = beginProgressiveMount(sessionID)
    expect(isProgressiveMountInFlight(sessionID)).toBe(true)

    endProgressiveMount(sessionID, token)
    expect(isProgressiveMountInFlight(sessionID)).toBe(false)
  })

  test('endProgressiveMount with a WRONG token does NOT clear (stale finally guard)', () => {
    const sessionID = 'ses_token_wrong'
    const token = beginProgressiveMount(sessionID)
    expect(isProgressiveMountInFlight(sessionID)).toBe(true)

    // Simulate a stale finally from an OLDER request (wrong token).
    // It must NOT clear the current flag.
    endProgressiveMount(sessionID, token - 999)
    expect(isProgressiveMountInFlight(sessionID)).toBe(true)

    // Cleanup: clear with the correct token.
    endProgressiveMount(sessionID, token)
    expect(isProgressiveMountInFlight(sessionID)).toBe(false)
  })

  test('OVERLAP: older progressive mount finishes, but a newer one started — older finally must NOT clear newer flag', () => {
    // This is the core race condition from Medium risk 5:
    // 1. Request A starts (token_1).
    // 2. Request B starts for the SAME session (token_2), overwriting token_1.
    // 3. Request A finishes. Its finally calls endProgressiveMount with token_1.
    //    The stored token is token_2 (from B). They don't match → no clear.
    // 4. isProgressiveMountInFlight still returns true (B is still running).
    // 5. Request B finishes. Its finally calls endProgressiveMount with token_2.
    //    The stored token is token_2 → match → clear.
    // 6. isProgressiveMountInFlight returns false.
    const sessionID = 'ses_token_overlap'

    // Step 1: Request A starts.
    const tokenA = beginProgressiveMount(sessionID)
    expect(isProgressiveMountInFlight(sessionID)).toBe(true)

    // Step 2: Request B starts (same session, newer token).
    const tokenB = beginProgressiveMount(sessionID)
    expect(tokenB).not.toBe(tokenA) // tokens are unique
    expect(isProgressiveMountInFlight(sessionID)).toBe(true)

    // Step 3: Request A finishes — its finally must NOT clear B's flag.
    endProgressiveMount(sessionID, tokenA)
    expect(isProgressiveMountInFlight(sessionID)).toBe(true) // B still running!

    // Step 5: Request B finishes — its finally clears the flag.
    endProgressiveMount(sessionID, tokenB)
    expect(isProgressiveMountInFlight(sessionID)).toBe(false)
  })

  test('tokens are monotonically increasing', () => {
    const sessionID = 'ses_token_monotonic'
    const t1 = beginProgressiveMount(sessionID)
    const t2 = beginProgressiveMount(sessionID)
    const t3 = beginProgressiveMount(sessionID)
    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)

    // Cleanup: clear with the latest token.
    endProgressiveMount(sessionID, t3)
  })
})
