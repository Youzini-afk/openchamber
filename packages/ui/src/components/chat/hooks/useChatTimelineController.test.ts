import { describe, expect, test } from 'bun:test';

import {
    shouldLoadEarlierFromHistoryScroll,
    shouldAutoLoadEarlierForUnderfilledPinnedViewport,
} from './useChatTimelineController';
import { isProgressiveMountInFlight } from '@/sync/use-sync';

const baseInput = {
    sessionId: 'ses_1',
    isPinned: true,
    canLoadEarlier: true,
    isLoadingOlder: false,
    pendingRevealWork: false,
    scrollHeight: 799,
    clientHeight: 800,
};

describe('shouldAutoLoadEarlierForUnderfilledPinnedViewport', () => {
    test('loads when pinned content does not fill the viewport', () => {
        expect(shouldAutoLoadEarlierForUnderfilledPinnedViewport(baseInput)).toBe(true);
    });

    test('does not load when content already overflows', () => {
        expect(shouldAutoLoadEarlierForUnderfilledPinnedViewport({
            ...baseInput,
            scrollHeight: 802,
        })).toBe(false);
    });

    test('does not load while user is away from bottom or history work is active', () => {
        expect(shouldAutoLoadEarlierForUnderfilledPinnedViewport({
            ...baseInput,
            isPinned: false,
        })).toBe(false);
        expect(shouldAutoLoadEarlierForUnderfilledPinnedViewport({
            ...baseInput,
            isLoadingOlder: true,
        })).toBe(false);
        expect(shouldAutoLoadEarlierForUnderfilledPinnedViewport({
            ...baseInput,
            pendingRevealWork: true,
        })).toBe(false);
    });
});

describe('shouldLoadEarlierFromHistoryScroll', () => {
    const scrollInput = {
        sessionId: 'ses_1',
        isPinned: false,
        scrollTop: 100,
        threshold: 200,
        canLoadEarlier: true,
        isLoadingOlder: false,
        pendingRevealWork: false,
        historyInteractionActive: false,
        progressiveMountInFlight: false,
    };

    test('loads when released near the top and no history work is active', () => {
        expect(shouldLoadEarlierFromHistoryScroll(scrollInput)).toBe(true);
    });

    test('does not chain loads during history interaction or progressive mount', () => {
        expect(shouldLoadEarlierFromHistoryScroll({
            ...scrollInput,
            historyInteractionActive: true,
        })).toBe(false);
        expect(shouldLoadEarlierFromHistoryScroll({
            ...scrollInput,
            progressiveMountInFlight: true,
        })).toBe(false);
    });

    test('does not load while pinned, away from top, or already busy', () => {
        expect(shouldLoadEarlierFromHistoryScroll({ ...scrollInput, isPinned: true })).toBe(false);
        expect(shouldLoadEarlierFromHistoryScroll({ ...scrollInput, scrollTop: 250 })).toBe(false);
        expect(shouldLoadEarlierFromHistoryScroll({ ...scrollInput, isLoadingOlder: true })).toBe(false);
        expect(shouldLoadEarlierFromHistoryScroll({ ...scrollInput, pendingRevealWork: true })).toBe(false);
    });
});

/**
 * Fix 6: loadEarlierIfPinnedViewportUnderfilled checks
 * isProgressiveMountInFlight(sessionId) before dispatching a second prepend.
 * The guard prevents a double delta application when progressive mount is
 * already prepending older history for the same session.
 *
 * isProgressiveMountInFlight is a module-level function exported from use-sync.
 * It reads a Map that is set true when progressive mount starts and cleared
 * in the finally block when it finishes. The controller calls it imperatively
 * (no subscription) so the check is always current.
 */
describe('isProgressiveMountInFlight guard (Fix 6)', () => {
    test('returns false for sessions with no progressive mount in flight', () => {
        // In the test environment, no progressive mounts have been dispatched,
        // so the Map is empty and the function returns false for any session.
        expect(isProgressiveMountInFlight('ses_test_no_progressive')).toBe(false);
    });

    test('does not throw for empty or unusual session ids', () => {
        let threwEmpty = false;
        try { isProgressiveMountInFlight(''); } catch { threwEmpty = true; }
        expect(threwEmpty).toBe(false);

        let threwSpecial = false;
        try { isProgressiveMountInFlight('ses_with_special_chars_!@#'); } catch { threwSpecial = true; }
        expect(threwSpecial).toBe(false);
    });
});

/**
 * Fix 7: the turn model cache hit condition was loosened from strict reference
 * equality (cached.messages === messages) to "same length + same first/last
 * message id". This test verifies the equivalence condition used by the hook's
 * useMemo to decide whether to use the incremental update path.
 *
 * The hook's actual useMemo cannot be rendered without a DOM test library,
 * but the condition itself is a pure comparison that can be verified here.
 */
describe('loose cache hit condition (Fix 7)', () => {
    type FakeEntry = { info: { id: string }; parts: unknown[] };

    const isLooseCacheHit = (
        cached: { messages: FakeEntry[] },
        messages: FakeEntry[],
    ): boolean => {
        if (cached.messages.length !== messages.length || messages.length === 0) {
            return false;
        }
        const cachedFirstId = cached.messages[0]?.info?.id ?? null;
        const cachedLastId = cached.messages[cached.messages.length - 1]?.info?.id ?? null;
        const currentFirstId = messages[0]?.info?.id ?? null;
        const currentLastId = messages[messages.length - 1]?.info?.id ?? null;
        return cachedFirstId === currentFirstId && cachedLastId === currentLastId;
    };

    test('hits when same length + same first/last id (even if interior refs differ)', () => {
        const cached = {
            messages: [
                { info: { id: 'msg_1' }, parts: [{ type: 'text', text: 'a' }] },
                { info: { id: 'msg_2' }, parts: [{ type: 'text', text: 'b' }] },
            ],
        };
        // New array, new interior object references, but same first/last id.
        const messages = [
            { info: { id: 'msg_1' }, parts: [{ type: 'text', text: 'a grew' }] },
            { info: { id: 'msg_2' }, parts: [{ type: 'text', text: 'b grew' }] },
        ];
        expect(isLooseCacheHit(cached, messages)).toBe(true);
    });

    test('misses when length differs (append or prepend)', () => {
        const cached = {
            messages: [{ info: { id: 'msg_1' }, parts: [] }],
        };
        const messages = [
            { info: { id: 'msg_1' }, parts: [] },
            { info: { id: 'msg_2' }, parts: [] },
        ];
        expect(isLooseCacheHit(cached, messages)).toBe(false);
    });

    test('misses when first id changes (prepend or session switch)', () => {
        const cached = {
            messages: [
                { info: { id: 'msg_1' }, parts: [] },
                { info: { id: 'msg_2' }, parts: [] },
            ],
        };
        const messages = [
            { info: { id: 'msg_0' }, parts: [] }, // different first id
            { info: { id: 'msg_2' }, parts: [] },
        ];
        expect(isLooseCacheHit(cached, messages)).toBe(false);
    });

    test('misses when last id changes (new message appended with different id)', () => {
        const cached = {
            messages: [
                { info: { id: 'msg_1' }, parts: [] },
                { info: { id: 'msg_2' }, parts: [] },
            ],
        };
        const messages = [
            { info: { id: 'msg_1' }, parts: [] },
            { info: { id: 'msg_3' }, parts: [] }, // different last id
        ];
        expect(isLooseCacheHit(cached, messages)).toBe(false);
    });

    test('misses for empty messages array', () => {
        const cached = { messages: [] as FakeEntry[] };
        expect(isLooseCacheHit(cached, [])).toBe(false);
    });
});

/**
 * Fix 5: prepend detection no longer requires currentNewestId === prev.newestId.
 * When streaming + prepend land in the same commit, newestId also changes.
 * The fix compensates by height delta whenever oldestId changes within the
 * same session, regardless of newestId. This test verifies the detection
 * condition.
 */
describe('prepend detection condition (Fix 5)', () => {
    type TrackingState = {
        oldestId: string | null;
        newestId: string | null;
        sessionId: string | null;
    };

    const isPrependDetected = (
        prev: TrackingState | null,
        currentOldestId: string | null,
        currentSessionId: string | null,
    ): boolean => {
        return Boolean(
            prev
            && prev.oldestId
            && currentOldestId
            && currentOldestId !== prev.oldestId
            && prev.sessionId === currentSessionId,
        );
    };

    test('detects prepend when oldestId changes within the same session', () => {
        const prev: TrackingState = {
            oldestId: 'msg_5',
            newestId: 'msg_10',
            sessionId: 'ses_1',
        };
        // Oldest changed (prepend), newest also changed (streaming) — old guard
        // would have missed this (required newestId === prev.newestId).
        expect(isPrependDetected(prev, 'msg_1', 'ses_1')).toBe(true);
    });

    test('does not detect prepend when oldestId is unchanged (append-only)', () => {
        const prev: TrackingState = {
            oldestId: 'msg_1',
            newestId: 'msg_10',
            sessionId: 'ses_1',
        };
        // Same oldest, different newest — this is an append, not a prepend.
        expect(isPrependDetected(prev, 'msg_1', 'ses_1')).toBe(false);
    });

    test('does not detect prepend when session changed (session switch)', () => {
        const prev: TrackingState = {
            oldestId: 'msg_1',
            newestId: 'msg_10',
            sessionId: 'ses_A',
        };
        // Oldest changed, but session also changed — this is a session switch,
        // not a prepend. Don't compensate (restoreSnapshot handles it).
        expect(isPrependDetected(prev, 'msg_100', 'ses_B')).toBe(false);
    });

    test('does not detect prepend when prev tracking state is null (first render)', () => {
        expect(isPrependDetected(null, 'msg_1', 'ses_1')).toBe(false);
    });

    test('does not detect prepend when oldestId is null', () => {
        const prev: TrackingState = {
            oldestId: 'msg_1',
            newestId: 'msg_10',
            sessionId: 'ses_1',
        };
        expect(isPrependDetected(prev, null, 'ses_1')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Fix C2: measurement-settled watch. The controller begins a generation on
// session enter and runs a rAF loop watching container.scrollHeight. When
// scrollHeight is stable for MEASUREMENT_SETTLE_FRAMES it marks the generation
// settled (which the progressive-mount slot waits for). clientHeight changes
// (viewport resize) must NOT count as content settle — only reset the stable
// counter. A hard frame/time cap force-marks settled so progressive mount
// never waits forever.
// ---------------------------------------------------------------------------
describe('measurement-settled watch (Fix C2)', () => {
    const SETTLE_FRAMES = 3;
    const MAX_FRAMES = 120;
    const MAX_MS = 2000;

    const createMeasurementWatch = (options: {
        scrollHeight: (frame: number) => number;
        clientHeight: (frame: number) => number;
        hasContainer: () => boolean;
        currentSessionId: () => string;
        now: () => number;
    }) => {
        const rafQueue: Array<() => void> = [];
        const schedule = (cb: () => void) => { rafQueue.push(cb); return rafQueue.length; };
        const drainRAF = () => {
            const q = [...rafQueue];
            rafQueue.length = 0;
            for (const cb of q) cb();
        };

        const token = 1;
        let settled = false;
        let stopped = false;
        const state = {
            sessionId: 'ses_A',
            sessionKey: 'ses_A',
            token,
            lastScrollHeight: options.scrollHeight(0),
            lastClientHeight: options.clientHeight(0),
            stableFrames: 0,
            frames: 0,
            startedAt: options.now(),
        };

        const tick = () => {
            if (stopped) return;
            if (state.token !== token) return;
            if (options.currentSessionId() !== state.sessionId) { stopped = true; return; }
            if (!options.hasContainer()) { settled = true; stopped = true; return; }
            const sh = options.scrollHeight(state.frames);
            const ch = options.clientHeight(state.frames);
            state.frames += 1;
            if (sh === state.lastScrollHeight) {
                if (ch !== state.lastClientHeight) {
                    // Resize, not content settle: reset stable counter.
                    state.stableFrames = 0;
                    state.lastClientHeight = ch;
                } else {
                    state.stableFrames += 1;
                }
            } else {
                state.stableFrames = 0;
                state.lastScrollHeight = sh;
                state.lastClientHeight = ch;
            }
            const elapsed = options.now() - state.startedAt;
            if (state.stableFrames >= SETTLE_FRAMES) { settled = true; stopped = true; return; }
            if (state.frames >= MAX_FRAMES || elapsed >= MAX_MS) { settled = true; stopped = true; return; }
            schedule(tick);
        };

        return {
            start: () => { schedule(tick); },
            drainRAF,
            advanceFrame: () => { drainRAF(); },
            isSettled: () => settled,
            isStopped: () => stopped,
            getStableFrames: () => state.stableFrames,
        };
    };

    test('3 stable scrollHeight frames mark the generation settled', () => {
        let now = 0;
        const watch = createMeasurementWatch({
            scrollHeight: () => 1000, // stable from the start
            clientHeight: () => 200,
            hasContainer: () => true,
            currentSessionId: () => 'ses_A',
            now: () => now,
        });
        watch.start();
        watch.advanceFrame(); now += 16;
        watch.advanceFrame(); now += 16;
        watch.advanceFrame(); now += 16;
        expect(watch.getStableFrames()).toBe(3);
        expect(watch.isSettled()).toBe(true);
    });

    test('clientHeight change (resize) resets the stable counter without counting as content settle', () => {
        let now = 0;
        // scrollHeight stable, but clientHeight changes on frame 2 (resize).
        const watch = createMeasurementWatch({
            scrollHeight: () => 1000,
            clientHeight: (f) => (f >= 2 ? 180 : 200),
            hasContainer: () => true,
            currentSessionId: () => 'ses_A',
            now: () => now,
        });
        watch.start();
        watch.advanceFrame(); now += 16; // stable 1
        watch.advanceFrame(); now += 16; // stable 2
        watch.advanceFrame(); now += 16; // clientHeight changed → reset to 0
        expect(watch.getStableFrames()).toBe(0);
        expect(watch.isSettled()).toBe(false);
        // After resize stops, stable resumes and eventually settles.
        watch.advanceFrame(); now += 16;
        watch.advanceFrame(); now += 16;
        watch.advanceFrame(); now += 16;
        expect(watch.isSettled()).toBe(true);
    });

    test('a stale generation token does not mark a newer generation settled', () => {
        // The controller uses a token captured at begin time; a newer enter
        // overwrites the stored generation. This test asserts the contract
        // the controller relies on: a stale tick (whose captured session no
        // longer matches currentSessionId) stops without settling.
        let now = 0;
        let session = 'ses_A';
        const watch = createMeasurementWatch({
            scrollHeight: (f) => 1000 + f, // always changing → never stable
            clientHeight: () => 200,
            hasContainer: () => true,
            currentSessionId: () => session,
            now: () => now,
        });
        watch.start();
        watch.advanceFrame(); now += 16;
        // Newer enter for the same session → the old loop's captured session no
        // longer matches currentSessionId → it stops without settling.
        session = 'ses_A_reentered';
        watch.advanceFrame(); now += 16;
        expect(watch.isStopped()).toBe(true);
        expect(watch.isSettled()).toBe(false);
    });

    test('hard frame/time cap force-marks settled so progressive mount never deadlocks', () => {
        let now = 0;
        // scrollHeight never stabilizes (perpetual oscillation).
        const watch = createMeasurementWatch({
            scrollHeight: (f) => 1000 + (f % 2), // oscillates
            clientHeight: () => 200,
            hasContainer: () => true,
            currentSessionId: () => 'ses_A',
            now: () => now,
        });
        watch.start();
        for (let i = 0; i < MAX_FRAMES + 5; i += 1) {
            watch.advanceFrame();
            now += 16;
            if (watch.isStopped()) break;
        }
        expect(watch.isSettled()).toBe(true); // force-settled at cap
    });
});
