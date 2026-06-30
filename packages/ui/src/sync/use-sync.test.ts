import { describe, expect, test } from 'bun:test'

import {
  beginProgressiveMount,
  endProgressiveMount,
  isProgressiveMountInFlight,
  shouldFetchSessionForRenderableSync,
  beginMeasurementGeneration,
  markMeasurementSettled,
  isMeasurementSettled,
  clearMeasurementSettled,
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

// ---------------------------------------------------------------------------
// Fix C: measurement-settled signal. progressive mount waits for "settled"
// before prepending the second history page, so the prepend lands on stable
// content instead of on a still-measuring virtualizer storm.
// ---------------------------------------------------------------------------
describe('measurement-settled signal (Fix C)', () => {
  test('isMeasurementSettled is false for a session with no generation begun', () => {
    clearMeasurementSettled('ses_no_gen')
    expect(isMeasurementSettled('ses_no_gen')).toBe(false)
  })

  test('beginning a generation resets settled to false', () => {
    const sessionKey = 'ses_settled_reset'
    clearMeasurementSettled(sessionKey)
    const token = beginMeasurementGeneration(sessionKey)
    expect(isMeasurementSettled(sessionKey)).toBe(false)
    markMeasurementSettled(sessionKey, token)
    expect(isMeasurementSettled(sessionKey)).toBe(true)
    // Re-entering the same session (new generation) must clear settled so the
    // progressive slot re-waits for fresh measurement.
    beginMeasurementGeneration(sessionKey)
    expect(isMeasurementSettled(sessionKey)).toBe(false)
  })

  test('markMeasurementSettled only marks when the generation token still matches', () => {
    const sessionKey = 'ses_token_gen'
    clearMeasurementSettled(sessionKey)
    const tokenA = beginMeasurementGeneration(sessionKey)
    // A newer enter for the same session overwrites the generation.
    const tokenB = beginMeasurementGeneration(sessionKey)
    expect(tokenB).not.toBe(tokenA)

    // The stale loop (tokenA) marking settled must NOT pollute the current
    // generation (tokenB) — this is the core race: rapid session re-entry
    // must not let an old measurement loop falsely report the new entry settled.
    markMeasurementSettled(sessionKey, tokenA)
    expect(isMeasurementSettled(sessionKey)).toBe(false)

    // The current generation's mark applies.
    markMeasurementSettled(sessionKey, tokenB)
    expect(isMeasurementSettled(sessionKey)).toBe(true)
  })

  test('different sessionKeys are isolated', () => {
    clearMeasurementSettled('ses_iso_a')
    clearMeasurementSettled('ses_iso_b')
    const ta = beginMeasurementGeneration('ses_iso_a')
    const tb = beginMeasurementGeneration('ses_iso_b')
    markMeasurementSettled('ses_iso_a', ta)
    expect(isMeasurementSettled('ses_iso_a')).toBe(true)
    expect(isMeasurementSettled('ses_iso_b')).toBe(false)
    markMeasurementSettled('ses_iso_b', tb)
    expect(isMeasurementSettled('ses_iso_b')).toBe(true)
    clearMeasurementSettled('ses_iso_a')
    clearMeasurementSettled('ses_iso_b')
  })
})

// Replicates the waitForMeasurementSettled soft-gate contract: it resolves
// once settled, OR once a hard timeout elapses (never deadlocks). The actual
// function reads isMeasurementSettled + a Date deadline; this test exercises
// that contract against the exported signal.
describe('waitForMeasurementSettled soft-gate contract (Fix C3)', () => {
  test('resolves immediately once the generation is marked settled', () => {
    const sessionKey = 'ses_soft_settled'
    clearMeasurementSettled(sessionKey)
    const token = beginMeasurementGeneration(sessionKey)
    // Simulate the controller marking settled.
    markMeasurementSettled(sessionKey, token)
    // The real gate polls isMeasurementSettled; settled=true → resolve.
    expect(isMeasurementSettled(sessionKey)).toBe(true)
    clearMeasurementSettled(sessionKey)
  })

  test('a session with no active controller stays not-settled; the hard timeout (2000ms) is the only escape', () => {
    // No beginMeasurementGeneration was ever called → settled stays false.
    // The gate's hard timeout (MEASUREMENT_SETTLED_HARD_TIMEOUT_MS = 2000)
    // ensures it still resolves. This test asserts the precondition that makes
    // the timeout necessary: settled is false without a controller.
    const sessionKey = 'ses_no_controller'
    clearMeasurementSettled(sessionKey)
    expect(isMeasurementSettled(sessionKey)).toBe(false)
    clearMeasurementSettled(sessionKey)
  })
})
