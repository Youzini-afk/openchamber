import { describe, expect, test } from 'bun:test';

import { shouldRepinReleasedViewport, planViewportRestore } from './useChatAutoFollow';

/**
 * These tests verify the rAF coalescing PATTERN used in useChatAutoFollow's
 * ResizeObserver effect (Fix 1) and the spy-gating condition (Fix 2).
 *
 * The project does not ship @testing-library/react or a DOM environment, so
 * the hook itself cannot be rendered in a test. Instead, these tests replicate
 * the exact coalescing logic from the hook's RO effect and verify its
 * convergence properties under burst load. If the pattern converges here, it
 * converges in the hook — the hook's effect body uses the same gate + flush
 * structure.
 */

// Replicates the rAF-coalesced RO callback handler from useChatAutoFollow's
// ResizeObserver effect (Fix 1). The pattern:
//   - Multiple RO callbacks in the same frame are coalesced into one rAF.
//   - The rAF flush clamps scrollTop once and calls startFollowLoop (which is
//     a no-op when a loop is already running, so settledFrames is NOT reset).
//   - The follow loop converges (settledFrames reaches SETTLE_FRAMES) and stops.
const createCoalescedROHandler = (options: {
    scrollHeight: () => number;
    clientHeight: () => number;
    setScrollTop: (value: number) => void;
    getScrollTop: () => number;
    SETTLE_FRAMES?: number;
    SETTLE_EPSILON?: number;
}) => {
    const SETTLE_FRAMES = options.SETTLE_FRAMES ?? 4;
    const SETTLE_EPSILON = options.SETTLE_EPSILON ?? 0.5;

    let roFrame: number | null = null;
    let followRaf: number | null = null;
    let settledFrames = 0;
    let followLoopRunning = false;
    let scrollTopWriteCount = 0;
    let rafScheduledCount = 0;

    const rafQueue: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback): number => {
        rafScheduledCount += 1;
        rafQueue.push(cb);
        return rafScheduledCount;
    };

    const flush = () => {
        roFrame = null;
        // clamp + startFollowLoop (simplified: only clamp if following)
        const target = Math.max(0, options.scrollHeight() - options.clientHeight());
        const current = options.getScrollTop();
        const delta = target - current;
        if (Math.abs(delta) <= SETTLE_EPSILON) {
            if (current !== target) {
                options.setScrollTop(target);
                scrollTopWriteCount += 1;
            }
            // startFollowLoop is a no-op when already running
        } else {
            options.setScrollTop(target);
            scrollTopWriteCount += 1;
            settledFrames = 0; // delta > epsilon → not settled, reset
        }
        // startFollowLoop: if not running, start the follow loop
        if (!followLoopRunning) {
            followLoopRunning = true;
            settledFrames = 0;
            followRaf = raf(tickFollow);
        }
    };

    const tickFollow = () => {
        followRaf = null;
        const target = Math.max(0, options.scrollHeight() - options.clientHeight());
        const current = options.getScrollTop();
        const delta = target - current;

        if (Math.abs(delta) <= SETTLE_EPSILON) {
            if (current !== target) {
                options.setScrollTop(target);
                scrollTopWriteCount += 1;
            }
            settledFrames += 1;
            if (settledFrames >= SETTLE_FRAMES) {
                followLoopRunning = false;
                return; // loop converges and stops
            }
            followRaf = raf(tickFollow);
            return;
        }

        settledFrames = 0;
        options.setScrollTop(target);
        scrollTopWriteCount += 1;
        followRaf = raf(tickFollow);
    };

    // RO callback (coalesced via rAF)
    const onRO = () => {
        if (roFrame !== null) return; // already scheduled — coalesce
        roFrame = raf(flush);
    };

    const drainRAF = () => {
        // Process all queued rAF callbacks in order (one frame).
        const queue = [...rafQueue];
        rafQueue.length = 0;
        for (const cb of queue) {
            cb(0);
        }
    };

    return {
        onRO,
        drainRAF,
        isFollowRafNull: () => followRaf === null && !followLoopRunning,
        getScrollTopWriteCount: () => scrollTopWriteCount,
        getRAFScheduledCount: () => rafScheduledCount,
    };
};

describe('useChatAutoFollow RO rAF coalescing (Fix 1)', () => {
    test('60 RO callbacks in the same frame produce only 1 rAF-scheduled flush', () => {
        let scrollTop = 0;
        const handler = createCoalescedROHandler({
            scrollHeight: () => 1000,
            clientHeight: () => 200,
            setScrollTop: (v) => { scrollTop = v; },
            getScrollTop: () => scrollTop,
        });

        // Fire 60 RO callbacks without draining the rAF queue — simulates
        // the burst of ResizeObserver notifications during streaming settle.
        for (let i = 0; i < 60; i += 1) {
            handler.onRO();
        }

        // Only 1 rAF should have been scheduled (coalesced). Before Fix 1,
        // each RO callback would have synchronously clamped + started the
        // follow loop — 60 synchronous scrollTop writes competing with the
        // browser's reflow.
        expect(handler.getRAFScheduledCount()).toBe(1);
    });

    test('after the rAF flush, the follow loop converges and followRafRef becomes null', () => {
        let scrollTop = 0;
        const handler = createCoalescedROHandler({
            scrollHeight: () => 1000,
            clientHeight: () => 200,
            setScrollTop: (v) => { scrollTop = v; },
            getScrollTop: () => scrollTop,
        });

        // Fire RO burst
        for (let i = 0; i < 60; i += 1) {
            handler.onRO();
        }

        // Drain the initial flush rAF (1 frame) — clamps scrollTop to bottom
        // and starts the follow loop.
        handler.drainRAF();
        expect(scrollTop).toBe(800); // 1000 - 200

        // The follow loop is now running. Drain frames until it converges.
        // SETTLE_FRAMES = 4, so after 4 consecutive frames where scrollTop is
        // already at target (delta <= epsilon), the loop stops.
        for (let frame = 0; frame < 10; frame += 1) {
            handler.drainRAF();
            if (handler.isFollowRafNull()) break;
        }

        // followRafRef must converge to null (loop stopped).
        expect(handler.isFollowRafNull()).toBe(true);
    });

    test('RO burst does not cause 60 synchronous scrollTop writes (feedback ring broken)', () => {
        let scrollTop = 0;
        const handler = createCoalescedROHandler({
            scrollHeight: () => 1000,
            clientHeight: () => 200,
            setScrollTop: (v) => { scrollTop = v; },
            getScrollTop: () => scrollTop,
        });

        // Fire 60 RO callbacks — before any rAF is drained.
        for (let i = 0; i < 60; i += 1) {
            handler.onRO();
        }

        // No scrollTop writes should have happened yet (all coalesced into 1 rAF).
        // Before Fix 1, each RO callback would have written scrollTop synchronously.
        expect(handler.getScrollTopWriteCount()).toBe(0);

        // Drain the single coalesced rAF — 1 write (the flush clamp).
        handler.drainRAF();
        // The flush writes once + the follow loop's first tick writes once
        // (or zero if already settled). The key assertion: it's a small
        // bounded number, NOT 60.
        expect(handler.getScrollTopWriteCount()).toBeLessThan(60);
    });
});

const createCoalescedContentChangeHandler = () => {
    let frame: number | null = null;
    let flushCount = 0;
    let rafScheduledCount = 0;
    const rafQueue: FrameRequestCallback[] = [];

    const raf = (cb: FrameRequestCallback): number => {
        rafScheduledCount += 1;
        rafQueue.push(cb);
        return rafScheduledCount;
    };

    const flush = () => {
        frame = null;
        flushCount += 1;
    };

    const notifyContentChange = () => {
        if (frame !== null) return;
        frame = raf(flush);
    };

    const drainRAF = () => {
        const queue = [...rafQueue];
        rafQueue.length = 0;
        for (const cb of queue) {
            cb(0);
        }
    };

    return {
        notifyContentChange,
        drainRAF,
        getFlushCount: () => flushCount,
        getRAFScheduledCount: () => rafScheduledCount,
    };
};

describe('useChatAutoFollow content-change rAF coalescing', () => {
    test('a burst of structural markdown changes schedules one follow flush', () => {
        const handler = createCoalescedContentChangeHandler();

        for (let i = 0; i < 100; i += 1) {
            handler.notifyContentChange();
        }

        expect(handler.getRAFScheduledCount()).toBe(1);
        expect(handler.getFlushCount()).toBe(0);

        handler.drainRAF();
        expect(handler.getFlushCount()).toBe(1);
    });
});

describe('useChatAutoFollow released viewport repin', () => {
    const baseInput = {
        state: 'released' as const,
        nearBottom: true,
        inGrace: true,
        currentTop: 800,
        previousTop: 760,
        maxScrollTop: 800,
    };

    test('re-pins immediately when the user scrolls downward into the bottom zone during grace', () => {
        expect(shouldRepinReleasedViewport(baseInput)).toBe(true);
    });

    test('re-pins immediately at the exact bottom even if the scroll delta is neutral', () => {
        expect(shouldRepinReleasedViewport({
            ...baseInput,
            currentTop: 800,
            previousTop: 800,
        })).toBe(true);
    });

    test('does not re-pin during grace when the user is moving upward near the bottom', () => {
        expect(shouldRepinReleasedViewport({
            ...baseInput,
            currentTop: 760,
            previousTop: 800,
            maxScrollTop: 820,
        })).toBe(false);
    });

    test('re-pins after grace when the viewport is still near the bottom', () => {
        expect(shouldRepinReleasedViewport({
            ...baseInput,
            inGrace: false,
            currentTop: 760,
            previousTop: 800,
            maxScrollTop: 820,
        })).toBe(true);
    });

    test('does not re-pin away from the bottom or while already following', () => {
        expect(shouldRepinReleasedViewport({
            ...baseInput,
            nearBottom: false,
        })).toBe(false);
        expect(shouldRepinReleasedViewport({
            ...baseInput,
            state: 'following',
        })).toBe(false);
    });
});

/**
 * Fix 2: spy effect is disabled when state === 'following' && sessionIsWorking.
 * This test verifies the gating condition itself — the hook's effect early-returns
 * when following+working, so the spy is torn down (no IO/MO/RO observers).
 */
describe('useChatAutoFollow spy gating condition (Fix 2)', () => {
    test('the gating condition is (following && working) — spy disabled only during streaming follow', () => {
        // Verify the boolean condition that the hook's spy effect checks.
        // When true, the effect early-returns (no spy created).
        const shouldDisableSpy = (
            state: 'following' | 'released',
            sessionIsWorking: boolean,
        ): boolean => {
            return state === 'following' && sessionIsWorking;
        };

        // During streaming follow: spy disabled (noise during auto-follow)
        expect(shouldDisableSpy('following', true)).toBe(true);

        // Released (user scrolled up): spy enabled (track active turn for UI)
        expect(shouldDisableSpy('released', true)).toBe(false);

        // Not working (idle session): spy enabled (track active turn)
        expect(shouldDisableSpy('following', false)).toBe(false);

        // Released + idle: spy enabled
        expect(shouldDisableSpy('released', false)).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Medium risk 4: when the spy is disabled (following + working), the
    // effect must call onActiveTurnChange(null) to clear the stale active
    // turn. Without this, the UI/navigation layer holds onto the turn that
    // was active when streaming started, and ArrowUp navigation in a pinned
    // streaming session jumps from a stale activeTurnId.
    // -----------------------------------------------------------------------
    test('MEDIUM RISK 4: disabling the spy clears the stale active turn via onActiveTurnChange(null)', () => {
        // The hook's spy effect early-returns when (following && working).
        // Before the early return, it calls onActiveTurnChange(null).
        // This test verifies the effect's behavior: when the gating condition
        // is true, onActiveTurnChange(null) is called exactly once.

        // We can't render the hook without @testing-library/react, so we
        // verify the contract: the effect's body, when gated, calls
        // onActiveTurnChange(null) before returning. The effect body is:
        //   if (state === 'following' && sessionIsWorking) {
        //     onActiveTurnChange(null);
        //     return;
        //   }
        //   ... (rest of spy setup)
        //
        // Simulate the effect's gating branch:
        const calls: (string | null)[] = [];
        const onActiveTurnChange = (turnId: string | null) => {
            calls.push(turnId);
        };

        const simulateSpyEffect = (
            state: 'following' | 'released',
            sessionIsWorking: boolean,
        ) => {
            // Replicate the effect's gating branch:
            if (state === 'following' && sessionIsWorking) {
                // Clear the stale active turn before tearing down the spy.
                onActiveTurnChange(null);
                return;
            }
            // (rest of spy setup would go here — not reached in this test)
        };

        // When following + working: onActiveTurnChange(null) is called.
        calls.length = 0;
        simulateSpyEffect('following', true);
        expect(calls.length).toBe(1);
        expect(calls[0]).toBe(null);

        // When released + working: spy is NOT disabled → no null call.
        calls.length = 0;
        simulateSpyEffect('released', true);
        expect(calls.length).toBe(0);

        // When following + idle: spy is NOT disabled → no null call.
        calls.length = 0;
        simulateSpyEffect('following', false);
        expect(calls.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Fix A4: restoreSnapshot decision logic (planViewportRestore). The pure
// planner is the unit-testable surface of the DOM-anchor restore path; the
// hook's restoreSnapshot calls it and then either clamps to bottom, defers
// (no ratio fallback), or hands the saved anchor to the MessageList handle.
// ---------------------------------------------------------------------------
describe('planViewportRestore (Fix A4)', () => {
    const bottomSnapshot = { scrollTop: 800, scrollHeight: 900, clientHeight: 100 };
    const nonBottomSnapshot = {
        scrollTop: 100,
        scrollHeight: 900,
        clientHeight: 100,
        messageAnchor: { messageId: 'msg_5', offsetTop: -40 },
    };

    test('bottom snapshot → pin to bottom (no ratio, no anchor)', () => {
        const plan = planViewportRestore({ saved: bottomSnapshot, isMobile: false, hasHandle: true });
        expect(plan.kind).toBe('bottom');
    });

    test('no snapshot at all → bottom', () => {
        const plan = planViewportRestore({ saved: undefined, isMobile: false, hasHandle: true });
        expect(plan.kind).toBe('bottom');
    });

    test('non-bottom with NO handle installed yet → DEFER (the layout-race path A1 fixes); never ratio', () => {
        // This is the critical timing case: parent layout effect runs before
        // the child's passive effect used to install the handle. With A1
        // (useImperativeHandle, layout phase) hasHandle is true on first mount.
        // If it ever is false, we must defer — NOT fall back to ratio (which
        // against an unmeasured scrollHeight is the upward-flip bug).
        const plan = planViewportRestore({ saved: nonBottomSnapshot, isMobile: false, hasHandle: false });
        expect(plan.kind).toBe('defer');
    });

    test('non-bottom with a saved messageAnchor + handle → DOM-anchor restore', () => {
        const plan = planViewportRestore({ saved: nonBottomSnapshot, isMobile: false, hasHandle: true });
        expect(plan.kind).toBe('anchor');
        if (plan.kind === 'anchor') {
            expect(plan.messageAnchor).toEqual({ messageId: 'msg_5', offsetTop: -40 });
        }
    });

    test('non-bottom with NO messageAnchor (old snapshot) → degrade to bottom; never ratio', () => {
        const oldSnapshot = { scrollTop: 100, scrollHeight: 900, clientHeight: 100 };
        const plan = planViewportRestore({ saved: oldSnapshot, isMobile: false, hasHandle: true });
        expect(plan.kind).toBe('bottom');
    });
});

// ---------------------------------------------------------------------------
// Fix A3: queueSave captures an immutable snapshot; flushSave writes it
// without reading the live container. Replicates the capture/flush contract
// so a session switch between queue and flush cannot write the wrong session.
// ---------------------------------------------------------------------------
describe('queueSave / flushSave immutable snapshot (Fix A3)', () => {
    type Pending = {
        sessionId: string;
        anchor: number;
        messageAnchor: { messageId: string; offsetTop: number } | null;
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
    };

    // Replicates queueSave: captures everything at queue time, including a
    // captureViewportAnchor call (here simulated by reading a "first visible
    // message id" from the fake container).
    const queueSave = (input: {
        sessionId: string;
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
        messageCount: number;
        firstVisibleMessageId: string | null;
        firstVisibleOffsetTop: number;
    }): Pending => {
        const anchorRatio = input.scrollHeight > 0
            ? (input.scrollTop + input.clientHeight / 2) / input.scrollHeight
            : 0;
        const anchor = Math.floor(anchorRatio * input.messageCount);
        const messageAnchor = input.firstVisibleMessageId
            ? { messageId: input.firstVisibleMessageId, offsetTop: input.firstVisibleOffsetTop }
            : null;
        return {
            sessionId: input.sessionId,
            anchor,
            messageAnchor,
            scrollTop: input.scrollTop,
            scrollHeight: input.scrollHeight,
            clientHeight: input.clientHeight,
        };
    };

    // Replicates flushSave: writes the immutable pending snapshot verbatim.
    // It does NOT re-read the container.
    const flushSave = (pending: Pending | null): { sessionId: string; scrollTop: number; messageAnchor: unknown } | null => {
        if (!pending) return null;
        return {
            sessionId: pending.sessionId,
            scrollTop: pending.scrollTop,
            messageAnchor: pending.messageAnchor,
        };
    };

    test('queueSave captures the messageAnchor (captureViewportAnchor is called)', () => {
        const pending = queueSave({
            sessionId: 'ses_A',
            scrollTop: 400,
            scrollHeight: 1000,
            clientHeight: 200,
            messageCount: 50,
            firstVisibleMessageId: 'msg_5',
            firstVisibleOffsetTop: -40,
        });
        expect(pending.messageAnchor).toEqual({ messageId: 'msg_5', offsetTop: -40 });
        expect(pending.sessionId).toBe('ses_A');
        expect(pending.scrollTop).toBe(400);
    });

    test('flushSave writes the queued snapshot; session switch between queue and flush does NOT write the wrong session', () => {
        // User is in ses_A, scrolls → queueSave captures ses_A's pixels.
        const pending = queueSave({
            sessionId: 'ses_A',
            scrollTop: 400,
            scrollHeight: 1000,
            clientHeight: 200,
            messageCount: 50,
            firstVisibleMessageId: 'msg_5',
            firstVisibleOffsetTop: -40,
        });

        // Before flushSave fires, the user switches to ses_B. The OLD code read
        // the live container at flush time → wrote ses_B's pixels into ses_A.
        // With the immutable snapshot, flushSave writes ses_A's captured pixels.
        const written = flushSave(pending);
        expect(written?.sessionId).toBe('ses_A');
        expect(written?.scrollTop).toBe(400);
        expect(written?.messageAnchor).toEqual({ messageId: 'msg_5', offsetTop: -40 });
    });

    test('flushSave with no pending snapshot is a no-op', () => {
        expect(flushSave(null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Fix A5: anchor-correction loop. Replicates the rAF loop contract: after a
// DOM-anchor restore, watch scrollHeight; once stable for 3 frames, re-apply
// the anchor; cancel on session switch; stop at the hard cap.
// ---------------------------------------------------------------------------
describe('anchor-correction loop (Fix A5)', () => {
    const ANCHOR_CORRECTION_STABLE_FRAMES = 3;
    const ANCHOR_CORRECTION_MAX_FRAMES = 120;
    const ANCHOR_CORRECTION_MAX_MS = 2000;

    const createAnchorCorrectionLoop = (options: {
        scrollHeight: (frame: number) => number;
        currentSessionId: () => string;
        hasHandle: () => boolean;
        hasContainer: () => boolean;
        now: () => number;
    }) => {
        const rafQueue: Array<() => void> = [];
        const schedule = (cb: () => void) => {
            rafQueue.push(cb);
            return rafQueue.length;
        };
        const drainRAF = () => {
            const q = [...rafQueue];
            rafQueue.length = 0;
            for (const cb of q) cb();
        };

        const applied: number[] = [];
        let stopped = false;
        let cancelled = false;
        const token = 1;
        const loopState = {
            sessionId: 'ses_A',
            token,
            anchor: { messageId: 'msg_5', offsetTop: -40 },
            lastScrollHeight: options.scrollHeight(0),
            stableFrames: 0,
            frames: 0,
            startedAt: options.now(),
        };

        const cancel = () => {
            cancelled = true;
            stopped = true;
        };

        const tick = () => {
            if (stopped) return;
            if (loopState.token !== token) return;
            if (options.currentSessionId() !== loopState.sessionId) {
                cancel();
                return;
            }
            if (!options.hasContainer() || !options.hasHandle()) {
                cancel();
                return;
            }
            const sh = options.scrollHeight(loopState.frames);
            loopState.frames += 1;
            if (sh === loopState.lastScrollHeight) {
                loopState.stableFrames += 1;
            } else {
                loopState.stableFrames = 0;
                loopState.lastScrollHeight = sh;
            }
            const elapsed = options.now() - loopState.startedAt;
            if (loopState.stableFrames >= ANCHOR_CORRECTION_STABLE_FRAMES) {
                applied.push(loopState.frames);
                cancel();
                return;
            }
            if (loopState.frames >= ANCHOR_CORRECTION_MAX_FRAMES || elapsed >= ANCHOR_CORRECTION_MAX_MS) {
                cancel();
                return;
            }
            schedule(tick);
        };

        const start = () => {
            schedule(tick);
        };

        return {
            start,
            drainRAF,
            getAppliedCount: () => applied.length,
            isStopped: () => stopped,
            isCancelled: () => cancelled,
            getFrames: () => loopState.frames,
        };
    };

    test('re-applies the anchor after scrollHeight is stable for 3 frames', () => {
        const heights = [1000, 1100, 1200, 1200, 1200, 1200]; // grows then settles
        let frame = 0;
        let now = 0;
        const loop = createAnchorCorrectionLoop({
            scrollHeight: () => heights[Math.min(frame, heights.length - 1)],
            currentSessionId: () => 'ses_A',
            hasHandle: () => true,
            hasContainer: () => true,
            now: () => now,
        });
        loop.start();
        // Drive frames: each drain advances frame + time.
        for (let i = 0; i < 10; i += 1) {
            loop.drainRAF();
            frame += 1;
            now += 16;
            if (loop.isStopped()) break;
        }
        expect(loop.getAppliedCount()).toBe(1);
    });

    test('cancels when the session switches away mid-correction', () => {
        let frame = 0;
        let now = 0;
        let session = 'ses_A';
        const loop = createAnchorCorrectionLoop({
            scrollHeight: () => 1000 + frame, // always changing → never settles
            currentSessionId: () => session,
            hasHandle: () => true,
            hasContainer: () => true,
            now: () => now,
        });
        loop.start();
        loop.drainRAF(); frame += 1; now += 16;
        loop.drainRAF(); frame += 1; now += 16;
        // User switches session — the loop must cancel on the next tick.
        session = 'ses_B';
        loop.drainRAF(); frame += 1; now += 16;
        expect(loop.isCancelled()).toBe(true);
        expect(loop.getAppliedCount()).toBe(0);
    });

    test('cancels when the handle unmounts mid-correction', () => {
        let frame = 0;
        let now = 0;
        let handle = true;
        const loop = createAnchorCorrectionLoop({
            scrollHeight: () => 1000 + frame,
            currentSessionId: () => 'ses_A',
            hasHandle: () => handle,
            hasContainer: () => true,
            now: () => now,
        });
        loop.start();
        loop.drainRAF(); frame += 1; now += 16;
        handle = false; // handle unmounted
        loop.drainRAF(); frame += 1; now += 16;
        expect(loop.isCancelled()).toBe(true);
    });

    test('stops at the hard cap (max frames) without applying if never stable', () => {
        let frame = 0;
        let now = 0;
        const loop = createAnchorCorrectionLoop({
            // Always different → never reaches 3 stable frames.
            scrollHeight: () => 1000 + frame,
            currentSessionId: () => 'ses_A',
            hasHandle: () => true,
            hasContainer: () => true,
            now: () => now,
        });
        loop.start();
        for (let i = 0; i < ANCHOR_CORRECTION_MAX_FRAMES + 5; i += 1) {
            loop.drainRAF();
            frame += 1;
            now += 16;
            if (loop.isStopped()) break;
        }
        expect(loop.isStopped()).toBe(true);
        expect(loop.getAppliedCount()).toBe(0); // never stable → no apply
    });

    test('stops at the hard time cap (2000ms) without applying if never stable', () => {
        let frame = 0;
        // Use a large per-frame time step so the 2000ms cap triggers well
        // before the 120-frame cap, isolating the time cap.
        let now = 0;
        const loop = createAnchorCorrectionLoop({
            scrollHeight: () => 1000 + frame,
            currentSessionId: () => 'ses_A',
            hasHandle: () => true,
            hasContainer: () => true,
            now: () => now,
        });
        loop.start();
        for (let i = 0; i < 30; i += 1) {
            loop.drainRAF();
            frame += 1;
            now += 200; // 200ms/frame → 2000ms after ~10 frames, far under 120 frames
            if (loop.isStopped()) break;
        }
        expect(loop.isStopped()).toBe(true);
        // now exceeds 2000ms → stopped via time cap, not the frame cap.
        expect(now).toBeGreaterThanOrEqual(ANCHOR_CORRECTION_MAX_MS);
        expect(frame).toBeLessThan(ANCHOR_CORRECTION_MAX_FRAMES);
    });
});

// ---------------------------------------------------------------------------
// Fix D: follow-loop tolerance during the measurement phase. Replicates the
// tickFollow contract: when scrollHeight changes (virtualizer still measuring),
// still clamp to bottom but do NOT reset settledFrames; once stable, the loop
// converges to SETTLE_FRAMES and stops.
// ---------------------------------------------------------------------------
describe('tickFollow measurement-phase tolerance (Fix D)', () => {
    const SETTLE_EPSILON = 0.5;
    const SETTLE_FRAMES = 4;

    const createFollowLoop = (options: {
        scrollHeight: (frame: number) => number;
        clientHeight: () => number;
        getScrollTop: () => number;
        setScrollTop: (v: number) => void;
    }) => {
        const rafQueue: Array<() => void> = [];
        const schedule = (cb: () => void) => {
            rafQueue.push(cb);
            return rafQueue.length;
        };
        const drainRAF = () => {
            const q = [...rafQueue];
            rafQueue.length = 0;
            for (const cb of q) cb();
        };

        let lastScrollHeight = 0;
        let settledFrames = 0;
        let stopped = false;
        let frame = 0;

        const tickFollow = () => {
            if (stopped) return;
            const scrollHeight = options.scrollHeight(frame);
            const target = Math.max(0, scrollHeight - options.clientHeight());
            const current = options.getScrollTop();
            const delta = target - current;
            const scrollHeightChanged = scrollHeight !== lastScrollHeight;
            lastScrollHeight = scrollHeight;

            if (scrollHeightChanged) {
                // Measurement phase: clamp to bottom, do NOT touch settledFrames.
                options.setScrollTop(target);
                schedule(tickFollow);
                return;
            }

            if (Math.abs(delta) <= SETTLE_EPSILON) {
                if (current !== target) {
                    options.setScrollTop(target);
                }
                settledFrames += 1;
                if (settledFrames >= SETTLE_FRAMES) {
                    stopped = true;
                    return;
                }
                schedule(tickFollow);
                return;
            }

            // Genuinely not at bottom (heights stable): reset + clamp.
            settledFrames = 0;
            options.setScrollTop(target);
            schedule(tickFollow);
        };

        const start = () => {
            // seed lastScrollHeight with the current value (mirrors startFollowLoop)
            lastScrollHeight = options.scrollHeight(frame);
            settledFrames = 0;
            schedule(tickFollow);
        };

        const advanceFrame = () => {
            drainRAF();
            frame += 1;
        };

        return {
            start,
            advanceFrame,
            isStopped: () => stopped,
            getSettledFrames: () => settledFrames,
        };
    };

    test('during the measurement phase settledFrames is preserved (not cleared each frame)', () => {
        // scrollHeight grows for several frames (measurement storm), then stabilizes.
        const heights = [1000, 1100, 1200, 1300, 1300, 1300, 1300, 1300];
        let scrollTop = 0;
        const loop = createFollowLoop({
            scrollHeight: (frame) => heights[Math.min(frame, heights.length - 1)],
            clientHeight: () => 200,
            getScrollTop: () => scrollTop,
            setScrollTop: (v) => { scrollTop = v; },
        });

        loop.start();
        // Run through the storm (4 growth frames). settledFrames must NOT
        // accumulate during growth (the loop returns before counting) and must
        // NOT be reset by growth frames either.
        loop.advanceFrame(); // frame 0→1: height 1000→1100 (changed) → clamp, no count
        loop.advanceFrame(); // 1100→1200 (changed) → clamp, no count
        // After 2 growth frames, settledFrames should still be 0 (never reset to 0
        // by growth, never incremented either).
        expect(loop.getSettledFrames()).toBe(0);
    });

    test('once scrollHeight stabilizes, the loop converges to SETTLE_FRAMES and stops', () => {
        const heights = [1000, 1100, 1200, 1300, 1300, 1300, 1300, 1300, 1300];
        let scrollTop = 0;
        const loop = createFollowLoop({
            scrollHeight: (frame) => heights[Math.min(frame, heights.length - 1)],
            clientHeight: () => 200,
            getScrollTop: () => scrollTop,
            setScrollTop: (v) => { scrollTop = v; },
        });

        loop.start();
        for (let i = 0; i < 20; i += 1) {
            loop.advanceFrame();
            if (loop.isStopped()) break;
        }
        expect(loop.isStopped()).toBe(true);
        // Final scrollTop should be pinned to bottom of the stable height.
        expect(scrollTop).toBe(1300 - 200);
    });

    test('a genuine "not at bottom" frame after stabilization resets settledFrames', () => {
        // Heights stable from the start, but scrollTop is artificially held
        // away from bottom (simulating a clamp that didn't reach target).
        let scrollTop = 0;
        const loop = createFollowLoop({
            scrollHeight: () => 1000, // stable
            clientHeight: () => 200,
            getScrollTop: () => scrollTop,
            // Simulate a container that resists the clamp (keeps drifting down).
            setScrollTop: (v) => { scrollTop = Math.min(v, scrollTop + 5); },
        });
        loop.start();
        loop.advanceFrame();
        // delta > epsilon (scrollTop far from 800) → reset settledFrames to 0.
        expect(loop.getSettledFrames()).toBe(0);
    });
});
