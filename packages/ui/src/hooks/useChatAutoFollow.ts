import React from 'react';

import { MessageFreshnessDetector } from '@/lib/messageFreshness';
import { createScrollSpy } from '@/components/chat/lib/scroll/scrollSpy';
import { getViewportSessionMemory, useViewportStore, type SessionMemoryState } from '@/sync/viewport-store';
import type { MessageListHandle } from '@/components/chat/MessageList';

export type AutoFollowState = 'following' | 'released';

export type ContentChangeReason = 'text' | 'structural' | 'permission';

export interface AnimationHandlers {
    onChunk: () => void;
    onComplete: () => void;
    onStreamingCandidate?: () => void;
    onAnimationStart?: () => void;
    onReservationCancelled?: () => void;
    onReasoningBlock?: () => void;
    onAnimatedHeightChange?: (height: number) => void;
}

interface UseChatAutoFollowOptions {
    currentSessionId: string | null;
    sessionMessageCount: number;
    sessionIsWorking: boolean;
    isMobile: boolean;
    messageListRef?: React.RefObject<MessageListHandle | null>;
    onActiveTurnChange?: (turnId: string | null) => void;
}

export interface UseChatAutoFollowResult {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    state: AutoFollowState;
    isPinned: boolean;
    isOverflowing: boolean;
    isFollowingProgrammatically: boolean;
    showScrollButton: boolean;
    notifyContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    goToBottom: (mode?: 'instant' | 'smooth') => void;
    releaseAutoFollow: () => void;
    saveSnapshotNow: () => void;
    restoreSnapshot: () => Promise<boolean>;
}

const BOTTOM_SPACER_DESKTOP_VH = 0.10;
const BOTTOM_SPACER_MOBILE_PX = 40;
const PROGRAMMATIC_WRITE_WINDOW_MS = 200;
const SAVE_DEBOUNCE_MS = 150;
const SETTLE_EPSILON = 0.5;
const SETTLE_FRAMES = 4;
const TOUCH_FINGER_DOWN_THRESHOLD = 2;
const REPIN_GRACE_AFTER_RELEASE_MS = 1200;
// Fix A5: anchor-correction loop tuning. After a DOM-anchor restore, scrollHeight
// must be stable for this many frames before re-applying the anchor. A hard
// frame/time cap prevents an oscillating session from keeping the loop alive.
const ANCHOR_CORRECTION_STABLE_FRAMES = 3;
const ANCHOR_CORRECTION_MAX_FRAMES = 120;
const ANCHOR_CORRECTION_MAX_MS = 2000;
// Width of the programmatic-write window after an anchor restore/correction so
// the scroll handler does not interpret our own scrollTop write as user intent.
const ANCHOR_RESTORE_PROGRAMMATIC_WINDOW_MS = 500;

// The bottom of the chat has an empty spacer (10vh on desktop, 40px on mobile)
// — its height is exactly how far above scrollHeight the user can be while still
// looking at "empty" space. We use that same value as the threshold for both
// re-pinning auto-follow and showing the scroll-to-bottom button.
const computeBottomZoneThreshold = (isMobile: boolean, container?: HTMLElement | null): number => {
    if (isMobile) return BOTTOM_SPACER_MOBILE_PX;
    const height = container?.clientHeight ?? 0;
    if (height <= 0) return 96;
    return Math.max(48, height * BOTTOM_SPACER_DESKTOP_VH);
};

const distanceFromBottom = (el: HTMLElement): number => {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
};

const isNearBottom = (el: HTMLElement, isMobile: boolean): boolean => {
    return distanceFromBottom(el) <= computeBottomZoneThreshold(isMobile, el);
};

const isReleaseKey = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
    }
    switch (event.key) {
        case 'ArrowUp':
        case 'PageUp':
        case 'Home':
            return true;
        default:
            return false;
    }
};

const nestedScrollableTarget = (root: HTMLElement, target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const nested = target.closest('[data-scrollable]');
    if (!nested || nested === root || !(nested instanceof HTMLElement)) return null;
    return nested;
};

const nestedScrollableCanConsumeUp = (root: HTMLElement, target: EventTarget | null): boolean => {
    const nested = nestedScrollableTarget(root, target);
    if (!nested) return false;
    return nested.scrollTop > 0;
};

const isAtBottomSnapshot = (snapshot: NonNullable<SessionMemoryState['scrollPosition']>, isMobile: boolean): boolean => {
    const max = Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);
    if (max <= 0) return true;
    const threshold = computeBottomZoneThreshold(isMobile, null);
    return max - snapshot.scrollTop <= threshold;
};

// Fix A4: pure decision function for restoreSnapshot. Kept out of the hook
// so the restore strategy (DOM-anchor vs defer vs bottom) is unit-testable
// without rendering the hook.
//
// - Bottom snapshot (or no snapshot): pin to bottom (following + clamp).
// - Non-bottom with no MessageListHandle yet (layout race, handle installs in
//   the child's layout phase which runs before the parent's, but the
//   container may still be hydrating): DEFER. Do NOT fall back to the ratio
//   method — ratio against an unmeasured scrollHeight is the upward-flip bug.
// - Non-bottom with a saved messageAnchor: hand it to the handle's
//   restoreViewportAnchor. If that returns false the anchor's id is not in
//   the loaded history at all (it lives in an older, unloaded page) →
//   degrade to bottom (safest: user lands on the latest content, never
//   flipped upward). No ratio fallback.
// - Non-bottom with no messageAnchor (old snapshot written before this fix):
//   degrade to bottom. No ratio fallback against an estimated scrollHeight.
export type ViewportRestorePlan =
    | { kind: 'bottom' }
    | { kind: 'defer' }
    | { kind: 'anchor'; messageAnchor: { messageId: string; offsetTop: number } };

export const planViewportRestore = (input: {
    saved: NonNullable<SessionMemoryState['scrollPosition']> | undefined;
    isMobile: boolean;
    hasHandle: boolean;
}): ViewportRestorePlan => {
    const { saved, isMobile, hasHandle } = input;
    if (!saved || isAtBottomSnapshot(saved, isMobile)) {
        return { kind: 'bottom' };
    }
    if (!hasHandle) {
        return { kind: 'defer' };
    }
    if (saved.messageAnchor) {
        return { kind: 'anchor', messageAnchor: saved.messageAnchor };
    }
    return { kind: 'bottom' };
};

export const shouldRepinReleasedViewport = (input: {
    state: AutoFollowState;
    nearBottom: boolean;
    inGrace: boolean;
    currentTop: number;
    previousTop: number;
    maxScrollTop: number;
}): boolean => {
    if (input.state !== 'released') return false;
    if (!input.nearBottom) return false;
    if (!input.inGrace) return true;
    if (input.currentTop > input.previousTop + SETTLE_EPSILON) return true;
    return input.maxScrollTop - input.currentTop <= SETTLE_EPSILON;
};

export const useChatAutoFollow = ({
    currentSessionId,
    sessionMessageCount,
    sessionIsWorking,
    isMobile,
    messageListRef: messageListHandleRef,
    onActiveTurnChange,
}: UseChatAutoFollowOptions): UseChatAutoFollowResult => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const [containerEl, setContainerEl] = React.useState<HTMLDivElement | null>(null);
    const lastSeenContainerRef = React.useRef<HTMLDivElement | null>(null);

    const [state, setState] = React.useState<AutoFollowState>('following');
    const [isOverflowing, setIsOverflowing] = React.useState(false);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const [isFollowingProgrammatically, setIsFollowingProgrammatically] = React.useState(false);

    const stateRef = React.useRef<AutoFollowState>('following');
    const sessionMessageCountRef = React.useRef(sessionMessageCount);
    sessionMessageCountRef.current = sessionMessageCount;
    const currentSessionIdRef = React.useRef(currentSessionId);
    currentSessionIdRef.current = currentSessionId;

    const lastSessionIdRef = React.useRef<string | null>(null);
    const programmaticWriteUntilRef = React.useRef(0);
    const followRafRef = React.useRef<number | null>(null);
    const settledFramesRef = React.useRef(0);
    // Fix D: lastScrollHeightRef lets the follow loop distinguish a
    // measurement-phase frame (scrollHeight grew because the virtualizer
    // replaced an estimated item height with a measured one) from a genuine
    // "not at bottom" frame. During the measurement phase we still clamp to
    // bottom but do NOT reset settledFrames, so once heights stabilize the
    // loop converges quickly instead of resetting every frame.
    const lastScrollHeightRef = React.useRef(0);
    const lastScrollTopRef = React.useRef(0);
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const repinGraceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // Fix A3: pendingSaveRef now holds the FULL immutable snapshot captured at
    // queue time (anchor + messageAnchor + scrollTop/scrollHeight/clientHeight).
    // flushSave no longer reads the live container, so a session switch between
    // queue and flush cannot write the new session's pixels into the old
    // session's memory.
    const pendingSaveRef = React.useRef<{
        sessionId: string;
        anchor: number;
        messageAnchor: { messageId: string; offsetTop: number } | null;
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
    } | null>(null);
    const settleBurstRafRef = React.useRef<number | null>(null);
    const contentChangeFrameRef = React.useRef<number | null>(null);
    const lastUserReleaseAtRef = React.useRef(0);
    // When restoreSnapshot is invoked while ChatViewport is still hydrating
    // (skeleton rendered, no scroll container yet), we record the session here
    // so a follow-up effect can replay the restore once the container mounts.
    const pendingInitialRestoreRef = React.useRef<string | null>(null);

    // Fix A5: anchor-correction loop. After a DOM-anchor restore lands on an
    // unmeasured (estimated-height) virtualizer, scrollHeight grows frame over
    // frame as items are measured, drifting the viewport away from the saved
    // anchor. This rAF loop watches scrollHeight; once it's stable for
    // ANCHOR_CORRECTION_STABLE_FRAMES frames it re-applies the anchor to absorb
    // the drift, then stops. Tokenized so a stale loop from a prior session
    // cannot re-apply to the current session; cancellable from every
    // session-switch / user-release / cleanup path.
    const anchorCorrectionRafRef = React.useRef<number | null>(null);
    const anchorCorrectionStateRef = React.useRef<{
        sessionId: string;
        token: number;
        anchor: { messageId: string; offsetTop: number };
        lastScrollHeight: number;
        stableFrames: number;
        frames: number;
        startedAt: number;
    } | null>(null);
    const anchorCorrectionTokenCounterRef = React.useRef(0);

    const updateViewportAnchor = useViewportStore((s) => s.updateViewportAnchor);

    // Detect when the scroll container DOM element changes (mount, unmount, remount).
    // Without this, listener-attach effects would only ever bind to the element that
    // existed at the hook's first render, missing later mounts (e.g. after first send
    // promotes a draft session to a real chat with messages).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useLayoutEffect(() => {
        if (scrollRef.current !== lastSeenContainerRef.current) {
            lastSeenContainerRef.current = scrollRef.current;
            setContainerEl(scrollRef.current);
        }
    });

    const setStateValue = React.useCallback((next: AutoFollowState) => {
        if (stateRef.current === next) return;
        stateRef.current = next;
        setState(next);
    }, []);

    const markProgrammaticWrite = React.useCallback((durationMs = PROGRAMMATIC_WRITE_WINDOW_MS) => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        programmaticWriteUntilRef.current = Math.max(programmaticWriteUntilRef.current, now + durationMs);
    }, []);

    const isInProgrammaticWindow = React.useCallback(() => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return now < programmaticWriteUntilRef.current;
    }, []);

    const stopFollowLoop = React.useCallback(() => {
        if (followRafRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(followRafRef.current);
        }
        followRafRef.current = null;
        settledFramesRef.current = 0;
        // Fix D: clear lastScrollHeightRef so the next follow loop starts
        // fresh — a stale value from a prior loop/session would make the first
        // tick falsely read "scrollHeight unchanged" and skip the measurement
        // clamp.
        lastScrollHeightRef.current = 0;
        setIsFollowingProgrammatically(false);
    }, []);

    const cancelAnchorCorrection = React.useCallback(() => {
        if (anchorCorrectionRafRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(anchorCorrectionRafRef.current);
        }
        anchorCorrectionRafRef.current = null;
        anchorCorrectionStateRef.current = null;
    }, []);

    const startAnchorCorrectionLoop = React.useCallback((sessionId: string, anchor: { messageId: string; offsetTop: number }) => {
        cancelAnchorCorrection();
        if (typeof window === 'undefined') return;
        anchorCorrectionTokenCounterRef.current += 1;
        const token = anchorCorrectionTokenCounterRef.current;
        const container = scrollRef.current;
        anchorCorrectionStateRef.current = {
            sessionId,
            token,
            anchor,
            lastScrollHeight: container?.scrollHeight ?? 0,
            stableFrames: 0,
            frames: 0,
            startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        };
        const tick = () => {
            anchorCorrectionRafRef.current = null;
            const loopState = anchorCorrectionStateRef.current;
            if (!loopState || loopState.token !== token) return;
            if (currentSessionIdRef.current !== loopState.sessionId) {
                cancelAnchorCorrection();
                return;
            }
            // Fix A5: the correction loop only makes sense while the viewport
            // is in the released state we set after restore. If something
            // transitioned us to following (goToBottom / repin / send), bail —
            // re-applying a released-state anchor would fight the follow clamp.
            if (stateRef.current !== 'released') {
                cancelAnchorCorrection();
                return;
            }
            const currentContainer = scrollRef.current;
            if (!currentContainer) {
                cancelAnchorCorrection();
                return;
            }
            if (!messageListHandleRef?.current) {
                cancelAnchorCorrection();
                return;
            }
            const currentScrollHeight = currentContainer.scrollHeight;
            loopState.frames += 1;
            if (currentScrollHeight === loopState.lastScrollHeight) {
                loopState.stableFrames += 1;
            } else {
                loopState.stableFrames = 0;
                loopState.lastScrollHeight = currentScrollHeight;
            }
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - loopState.startedAt;
            if (loopState.stableFrames >= ANCHOR_CORRECTION_STABLE_FRAMES) {
                // Heights settled: re-apply the anchor to absorb the drift that
                // accumulated while the virtualizer was measuring. Mark the
                // write programmatic so the scroll handler ignores it.
                markProgrammaticWrite(ANCHOR_RESTORE_PROGRAMMATIC_WINDOW_MS);
                messageListHandleRef.current.restoreViewportAnchor(loopState.anchor);
                cancelAnchorCorrection();
                return;
            }
            if (loopState.frames >= ANCHOR_CORRECTION_MAX_FRAMES || elapsed >= ANCHOR_CORRECTION_MAX_MS) {
                // Hard cap: stop even if not fully stable so a perpetually
                // oscillating session never keeps this loop alive forever.
                cancelAnchorCorrection();
                return;
            }
            anchorCorrectionRafRef.current = window.requestAnimationFrame(tick);
        };
        anchorCorrectionRafRef.current = window.requestAnimationFrame(tick);
    }, [cancelAnchorCorrection, markProgrammaticWrite, messageListHandleRef]);

    const tickFollow = React.useCallback(() => {
        followRafRef.current = null;
        const container = scrollRef.current;
        if (!container) {
            stopFollowLoop();
            return;
        }
        if (stateRef.current !== 'following') {
            stopFollowLoop();
            return;
        }

        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        const current = container.scrollTop;
        const delta = target - current;
        const currentScrollHeight = container.scrollHeight;
        // Fix D: a changed scrollHeight means the virtualizer is still
        // measuring (estimated → real heights). Still clamp to bottom so the
        // viewport stays pinned, but do NOT reset settledFrames — keep its
        // current value so once heights stabilize the loop converges in
        // SETTLE_FRAMES rather than restarting every frame.
        const scrollHeightChanged = currentScrollHeight !== lastScrollHeightRef.current;
        lastScrollHeightRef.current = currentScrollHeight;

        if (scrollHeightChanged) {
            markProgrammaticWrite();
            container.scrollTop = target;
            lastScrollTopRef.current = container.scrollTop;
            followRafRef.current = window.requestAnimationFrame(tickFollow);
            return;
        }

        // The virtualized message list and async markdown highlighter can update
        // scrollHeight several times while a send/stream is settling. LERPing
        // toward a moving target makes the viewport visibly chase that target
        // and produces an up/down shake. While auto-following, the invariant is
        // simply "stay pinned to the current bottom"; clamp once per frame and
        // let resize/content-change signals schedule another clamp if needed.
        if (Math.abs(delta) <= SETTLE_EPSILON) {
            if (current !== target) {
                markProgrammaticWrite();
                container.scrollTop = target;
                lastScrollTopRef.current = target;
            }
            settledFramesRef.current += 1;
            if (settledFramesRef.current >= SETTLE_FRAMES) {
                stopFollowLoop();
                return;
            }
            followRafRef.current = window.requestAnimationFrame(tickFollow);
            return;
        }

        settledFramesRef.current = 0;
        markProgrammaticWrite();
        container.scrollTop = target;
        lastScrollTopRef.current = container.scrollTop;
        followRafRef.current = window.requestAnimationFrame(tickFollow);
    }, [markProgrammaticWrite, stopFollowLoop]);

    const startFollowLoop = React.useCallback(() => {
        if (typeof window === 'undefined') return;
        if (followRafRef.current !== null) return;
        if (stateRef.current !== 'following') return;
        settledFramesRef.current = 0;
        // Fix D: seed lastScrollHeightRef to the current scrollHeight so the
        // first tick's "scrollHeightChanged" comparison is meaningful. If the
        // container isn't ready yet, 0 forces the first real tick to treat
        // the first observed scrollHeight as a clamp frame.
        lastScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0;
        setIsFollowingProgrammatically(true);
        followRafRef.current = window.requestAnimationFrame(tickFollow);
    }, [tickFollow]);

    const writeScrollTopInstant = React.useCallback((target: number) => {
        const container = scrollRef.current;
        if (!container) return;
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        const clamped = Math.max(0, Math.min(target, max));
        markProgrammaticWrite();
        container.scrollTop = clamped;
        lastScrollTopRef.current = container.scrollTop;
    }, [markProgrammaticWrite]);

    const clampToBottomIfFollowing = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container || stateRef.current !== 'following') return;
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
    }, [writeScrollTopInstant]);

    const stopSettleBurst = React.useCallback(() => {
        if (settleBurstRafRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(settleBurstRafRef.current);
        }
        settleBurstRafRef.current = null;
    }, []);

    const stopContentChangeFrame = React.useCallback(() => {
        if (contentChangeFrameRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(contentChangeFrameRef.current);
        }
        contentChangeFrameRef.current = null;
    }, []);

    const cancelRepinGraceTimer = React.useCallback(() => {
        if (repinGraceTimerRef.current !== null) {
            clearTimeout(repinGraceTimerRef.current);
            repinGraceTimerRef.current = null;
        }
    }, []);

    const scheduleRepinAfterGrace = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container || stateRef.current !== 'released') return;
        if (!isNearBottom(container, isMobile)) return;
        if (repinGraceTimerRef.current !== null) return;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = now - lastUserReleaseAtRef.current;
        const delay = Math.max(0, REPIN_GRACE_AFTER_RELEASE_MS - elapsed);

        repinGraceTimerRef.current = setTimeout(() => {
            repinGraceTimerRef.current = null;
            const latestContainer = scrollRef.current;
            if (!latestContainer || stateRef.current !== 'released') return;
            if (!isNearBottom(latestContainer, isMobile)) return;

            setStateValue('following');
            lastUserReleaseAtRef.current = 0;
            startFollowLoop();
        }, delay);
    }, [isMobile, setStateValue, startFollowLoop]);

    const releaseAutoFollow = React.useCallback(() => {
        stopFollowLoop();
        stopSettleBurst();
        cancelRepinGraceTimer();
        cancelAnchorCorrection();
        lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setStateValue('released');
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, setStateValue, stopFollowLoop, stopSettleBurst]);

    const releaseFromUserIntent = React.useCallback(() => {
        cancelRepinGraceTimer();
        if (stateRef.current === 'following') {
            stopFollowLoop();
            stopSettleBurst();
            cancelAnchorCorrection();
            lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
            setStateValue('released');
        } else {
            lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        }
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, setStateValue, stopFollowLoop, stopSettleBurst]);

    const goToBottom = React.useCallback((mode: 'instant' | 'smooth' = 'instant') => {
        const container = scrollRef.current;
        setStateValue('following');
        lastUserReleaseAtRef.current = 0;
        cancelRepinGraceTimer();
        cancelAnchorCorrection();
        if (!container) return;
        if (mode === 'smooth') {
            const target = Math.max(0, container.scrollHeight - container.clientHeight);
            stopFollowLoop();
            stopSettleBurst();
            markProgrammaticWrite(800);
            container.scrollTo({ top: target, behavior: 'smooth' });
            return;
        }
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        stopFollowLoop();
        stopSettleBurst();
        writeScrollTopInstant(target);
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, markProgrammaticWrite, setStateValue, stopFollowLoop, stopSettleBurst, writeScrollTopInstant]);

    const flushSave = React.useCallback(() => {
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current;
        if (!pending) return;
        // Fix A3: write the immutable snapshot captured at queue time. We do
        // NOT read the live container here — between queue and flush the
        // session may have changed, and reading the new container's pixels
        // would persist the wrong session's scroll state into the old
        // session's memory (the upward-flip bug on re-entry).
        updateViewportAnchor(pending.sessionId, pending.anchor, {
            scrollTop: pending.scrollTop,
            scrollHeight: pending.scrollHeight,
            clientHeight: pending.clientHeight,
            ...(pending.messageAnchor ? { messageAnchor: pending.messageAnchor } : {}),
        });
        pendingSaveRef.current = null;
    }, [updateViewportAnchor]);

    const queueSave = React.useCallback(() => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) return;
        const container = scrollRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const anchorRatio = scrollHeight > 0
            ? (scrollTop + clientHeight / 2) / scrollHeight
            : 0;
        const anchor = Math.floor(anchorRatio * sessionMessageCountRef.current);
        // Fix A3: capture the DOM anchor (and pixel state) NOW, at queue time,
        // so flushSave writes an immutable snapshot. captureViewportAnchor
        // finds the first visible [data-message-id] row; null when no row is
        // visible (e.g. empty/skeleton) and restoreSnapshot then degrades to
        // bottom on re-entry.
        const messageAnchor = messageListHandleRef?.current?.captureViewportAnchor() ?? null;

        pendingSaveRef.current = {
            sessionId,
            anchor,
            messageAnchor,
            scrollTop,
            scrollHeight,
            clientHeight,
        };
        if (saveTimerRef.current !== null) return;
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            flushSave();
        }, SAVE_DEBOUNCE_MS);
    }, [flushSave, messageListHandleRef]);

    const saveSnapshotNow = React.useCallback(() => {
        flushSave();
    }, [flushSave]);

    const restoreSnapshot = React.useCallback(async (): Promise<boolean> => {
        const sessionId = currentSessionIdRef.current;
        if (!sessionId) return false;

        const container = scrollRef.current;
        if (!container) {
            // ChatViewport not mounted yet (e.g., session still hydrating).
            // Record the request so the container-attach effect can replay it.
            pendingInitialRestoreRef.current = sessionId;
            setStateValue('following');
            cancelRepinGraceTimer();
            return false;
        }
        pendingInitialRestoreRef.current = null;

        const saved = getViewportSessionMemory(sessionId)?.scrollPosition;
        const plan = planViewportRestore({ saved, isMobile, hasHandle: Boolean(messageListHandleRef?.current) });

        if (plan.kind === 'bottom') {
            setStateValue('following');
            lastUserReleaseAtRef.current = 0;
            cancelRepinGraceTimer();
            cancelAnchorCorrection();
            const target = Math.max(0, container.scrollHeight - container.clientHeight);
            writeScrollTopInstant(target);
            startFollowLoop();
            return false;
        }

        if (plan.kind === 'defer') {
            // Handle not installed yet (child layout race or container still
            // hydrating). Defer to the container-attach replay. Do NOT fall
            // back to the ratio method — ratio against an unmeasured
            // scrollHeight is the upward-flip root cause.
            pendingInitialRestoreRef.current = sessionId;
            setStateValue('following');
            cancelRepinGraceTimer();
            return false;
        }

        // plan.kind === 'anchor': hand the saved DOM anchor to the handle.
        cancelRepinGraceTimer();
        markProgrammaticWrite(ANCHOR_RESTORE_PROGRAMMATIC_WINDOW_MS);
        const restored = messageListHandleRef?.current?.restoreViewportAnchor(plan.messageAnchor) ?? false;
        if (restored) {
            // Element was in the DOM, or restoreViewportAnchor fell back to
            // scrollHistoryIndexIntoView for a virtualized (out-of-viewport)
            // history item. Either way the anchor is addressable in the
            // loaded history — release and start the measurement-stability
            // correction loop to absorb drift while the virtualizer measures.
            setStateValue('released');
            lastUserReleaseAtRef.current = 0;
            startAnchorCorrectionLoop(sessionId, plan.messageAnchor);
            return true;
        }

        // restoreViewportAnchor returned false: the anchor's id is not in the
        // loaded history at all (it lives in an older, unloaded page). Degrade
        // to bottom — the user lands on the latest content and is never
        // flipped upward. No ratio fallback.
        setStateValue('following');
        lastUserReleaseAtRef.current = 0;
        cancelRepinGraceTimer();
        cancelAnchorCorrection();
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
        startFollowLoop();
        return false;
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, isMobile, markProgrammaticWrite, messageListHandleRef, setStateValue, startAnchorCorrectionLoop, startFollowLoop, writeScrollTopInstant]);

    React.useEffect(() => {
        if (!currentSessionId || currentSessionId === lastSessionIdRef.current) {
            return;
        }
        lastSessionIdRef.current = currentSessionId;
        MessageFreshnessDetector.getInstance().recordSessionStart(currentSessionId);
        flushSave();
        stopFollowLoop();
        stopSettleBurst();
        cancelRepinGraceTimer();
        cancelAnchorCorrection();
        // Fix D: clear lastScrollHeightRef on session switch so the new
        // session's follow loop does not compare against the prior session's
        // scrollHeight and falsely skip the measurement-phase clamp.
        lastScrollHeightRef.current = 0;
        markProgrammaticWrite();
        // Drop any pending restore request inherited from a different session.
        if (pendingInitialRestoreRef.current && pendingInitialRestoreRef.current !== currentSessionId) {
            pendingInitialRestoreRef.current = null;
        }
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, currentSessionId, flushSave, markProgrammaticWrite, stopFollowLoop, stopSettleBurst]);

    React.useEffect(() => {
        if (sessionIsWorking && stateRef.current === 'following') {
            startFollowLoop();
        }
    }, [sessionIsWorking, startFollowLoop]);

    // Replay a deferred restoreSnapshot once ChatViewport mounts.
    React.useLayoutEffect(() => {
        if (!containerEl) return;
        if (pendingInitialRestoreRef.current && pendingInitialRestoreRef.current === currentSessionId) {
            void restoreSnapshot();
        }
    }, [containerEl, currentSessionId, restoreSnapshot]);

    const updateOverflowAndButton = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) {
            setIsOverflowing(false);
            setShowScrollButton(false);
            return;
        }
        const overflowing = container.scrollHeight > container.clientHeight + 1;
        setIsOverflowing(overflowing);
        if (!overflowing) {
            setShowScrollButton(false);
            return;
        }
        const showButton = stateRef.current === 'released' && !isNearBottom(container, isMobile);
        setShowScrollButton(showButton);
    }, [isMobile]);

    React.useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        if (stateRef.current !== 'following') return;
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        writeScrollTopInstant(target);
        updateOverflowAndButton();
    }, [containerEl, sessionMessageCount, updateOverflowAndButton, writeScrollTopInstant]);

    const handleScrollEvent = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        const programmatic = isInProgrammaticWindow();
        const currentTop = container.scrollTop;
        const previousTop = lastScrollTopRef.current;
        lastScrollTopRef.current = currentTop;

        updateOverflowAndButton();

        if (programmatic) {
            return;
        }

        if (currentTop < previousTop && stateRef.current === 'following') {
            stopFollowLoop();
            stopSettleBurst();
            // Fix A5: a user-initiated upward scroll abandons any in-flight
            // anchor correction — the user is now driving the viewport.
            cancelAnchorCorrection();
            lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
            setStateValue('released');
        }

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const inGrace = (now - lastUserReleaseAtRef.current) < REPIN_GRACE_AFTER_RELEASE_MS;
        const nearBottom = isNearBottom(container, isMobile);
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        if (shouldRepinReleasedViewport({
            state: stateRef.current,
            nearBottom,
            inGrace,
            currentTop,
            previousTop,
            maxScrollTop,
        })) {
            cancelRepinGraceTimer();
            // Fix A5: repinning to following abandons any in-flight anchor
            // correction — the user is now back at the bottom, the correction
            // loop (for released state) is no longer relevant.
            cancelAnchorCorrection();
            setStateValue('following');
            lastUserReleaseAtRef.current = 0;
            startFollowLoop();
        } else if (stateRef.current === 'released' && nearBottom && inGrace) {
            scheduleRepinAfterGrace();
        } else if (stateRef.current === 'released' && !nearBottom) {
            cancelRepinGraceTimer();
        }

        queueSave();
    }, [
        cancelAnchorCorrection,
        isInProgrammaticWindow,
        isMobile,
        queueSave,
        cancelRepinGraceTimer,
        scheduleRepinAfterGrace,
        setStateValue,
        startFollowLoop,
        stopFollowLoop,
        stopSettleBurst,
        updateOverflowAndButton,
    ]);

    React.useEffect(() => {
        const container = containerEl;
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            if (event.deltaY >= 0) return;
            if (nestedScrollableCanConsumeUp(container, event.target)) return;
            releaseFromUserIntent();
        };

        let touchLastY: number | null = null;
        const handleTouchStart = (event: TouchEvent) => {
            const touch = event.touches.item(0);
            touchLastY = touch ? touch.clientY : null;
        };
        const handleTouchMove = (event: TouchEvent) => {
            const touch = event.touches.item(0);
            if (!touch) {
                touchLastY = null;
                return;
            }
            const previousY = touchLastY;
            touchLastY = touch.clientY;
            if (previousY === null) return;
            const fingerDelta = touch.clientY - previousY;
            if (fingerDelta <= TOUCH_FINGER_DOWN_THRESHOLD) return;
            if (nestedScrollableCanConsumeUp(container, event.target)) return;
            releaseFromUserIntent();
        };
        const handleTouchEnd = () => {
            touchLastY = null;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isReleaseKey(event)) return;
            releaseFromUserIntent();
        };

        const handlePointerDownIntent = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (!target.closest('[data-overlay-scrollbar-thumb]')) return;
            releaseFromUserIntent();
        };

        container.addEventListener('scroll', handleScrollEvent, { passive: true });
        container.addEventListener('wheel', handleWheel, { passive: true });
        container.addEventListener('touchstart', handleTouchStart, { passive: true });
        container.addEventListener('touchmove', handleTouchMove, { passive: true });
        container.addEventListener('touchend', handleTouchEnd, { passive: true });
        container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        container.addEventListener('keydown', handleKeyDown);
        if (typeof window !== 'undefined') {
            window.addEventListener('pointerdown', handlePointerDownIntent, true);
        }

        return () => {
            container.removeEventListener('scroll', handleScrollEvent);
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
            container.removeEventListener('touchcancel', handleTouchEnd);
            container.removeEventListener('keydown', handleKeyDown);
            if (typeof window !== 'undefined') {
                window.removeEventListener('pointerdown', handlePointerDownIntent, true);
            }
        };
    }, [containerEl, handleScrollEvent, releaseFromUserIntent]);

    React.useEffect(() => {
        const container = containerEl;
        if (!container || typeof ResizeObserver === 'undefined') return;

        // RO can fire many times per frame during streaming (markdown workers
        // settling, tool reveals, async height changes). Calling clamp +
        // startFollowLoop synchronously on every callback creates a feedback
        // loop: our scrollTop write triggers a reflow, which triggers another
        // RO callback, which writes scrollTop again — and settledFrames never
        // reaches SETTLE_FRAMES so the rAF loop runs forever. Coalesce all RO
        // callbacks within a frame into a single rAF flush (same pattern as
        // OverlayScrollbar's scheduleMetricsUpdate). startFollowLoop is a
        // no-op when a loop is already running, so the in-flight loop converges
        // naturally instead of being reset on every RO tick.
        let roFrame: number | null = null;
        const flush = () => {
            roFrame = null;
            updateOverflowAndButton();
            if (stateRef.current === 'following') {
                clampToBottomIfFollowing();
                startFollowLoop();
            }
        };
        const observer = new ResizeObserver(() => {
            if (roFrame !== null) return;
            roFrame = window.requestAnimationFrame(flush);
        });
        observer.observe(container);
        const inner = container.firstElementChild;
        if (inner instanceof Element) {
            observer.observe(inner);
        }
        return () => {
            if (roFrame !== null && typeof window !== 'undefined') {
                window.cancelAnimationFrame(roFrame);
                roFrame = null;
            }
            observer.disconnect();
        };
    }, [clampToBottomIfFollowing, containerEl, startFollowLoop, updateOverflowAndButton]);

    React.useEffect(() => {
        updateOverflowAndButton();
    }, [sessionMessageCount, updateOverflowAndButton]);

    const flushContentChangeFrame = React.useCallback(() => {
        contentChangeFrameRef.current = null;
        updateOverflowAndButton();
        const container = scrollRef.current;
        if (container && stateRef.current === 'released') {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const inGrace = (now - lastUserReleaseAtRef.current) < REPIN_GRACE_AFTER_RELEASE_MS;
            if (isNearBottom(container, isMobile) && !inGrace) {
                cancelRepinGraceTimer();
                setStateValue('following');
                lastUserReleaseAtRef.current = 0;
            }
        }
        if (stateRef.current === 'following') {
            clampToBottomIfFollowing();
            startFollowLoop();
        }
    }, [cancelRepinGraceTimer, clampToBottomIfFollowing, isMobile, setStateValue, startFollowLoop, updateOverflowAndButton]);

    const scheduleContentChangeFrame = React.useCallback(() => {
        if (typeof window === 'undefined') {
            flushContentChangeFrame();
            return;
        }
        if (contentChangeFrameRef.current !== null) return;
        contentChangeFrameRef.current = window.requestAnimationFrame(flushContentChangeFrame);
    }, [flushContentChangeFrame]);

    const notifyContentChange = React.useCallback((_reason?: ContentChangeReason) => {
        void _reason;
        scheduleContentChangeFrame();
    }, [scheduleContentChangeFrame]);

    const animationHandlersRef = React.useRef<Map<string, AnimationHandlers>>(new Map());

    const getAnimationHandlers = React.useCallback((messageId: string): AnimationHandlers => {
        const cached = animationHandlersRef.current.get(messageId);
        if (cached) return cached;

        const kick = () => {
            scheduleContentChangeFrame();
        };

        const handlers: AnimationHandlers = {
            onChunk: kick,
            onComplete: () => {
                updateOverflowAndButton();
            },
            onStreamingCandidate: () => {},
            onAnimationStart: () => {},
            onAnimatedHeightChange: kick,
            onReservationCancelled: () => {},
            onReasoningBlock: () => {},
        };
        animationHandlersRef.current.set(messageId, handlers);
        return handlers;
    }, [scheduleContentChangeFrame, updateOverflowAndButton]);

    React.useEffect(() => {
        return () => {
            stopFollowLoop();
            stopSettleBurst();
            stopContentChangeFrame();
            cancelRepinGraceTimer();
            cancelAnchorCorrection();
            flushSave();
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [cancelAnchorCorrection, cancelRepinGraceTimer, flushSave, stopContentChangeFrame, stopFollowLoop, stopSettleBurst]);

    React.useEffect(() => {
        if (!onActiveTurnChange) return;
        const container = containerEl;
        if (!container) return;

        // While auto-following a working (streaming) session, the active-turn
        // tracker is noise: the viewport is pinned to the bottom and the user
        // cannot read intermediate turns anyway. Keeping the spy's
        // IntersectionObserver / MutationObserver / ResizeObserver alive during
        // streaming adds rAF work that competes with the follow loop and feeds
        // the observer feedback ring. Tear the spy down (its cleanup calls
        // clear + disconnect) and re-create it when the user releases or the
        // session stops working.
        if (state === 'following' && sessionIsWorking) {
            // Clear the stale active turn so the UI/navigation layer doesn't
            // hold onto the turn that was active when streaming started.
            // Without this, ArrowUp navigation in a pinned streaming session
            // would jump from a stale activeTurnId instead of from the tail.
            onActiveTurnChange(null);
            return;
        }

        let lastActiveTurnId: string | null = null;
        const spy = createScrollSpy({
            onActive: (turnId) => {
                if (turnId === lastActiveTurnId) return;
                lastActiveTurnId = turnId;
                onActiveTurnChange(turnId);
            },
        });
        spy.setContainer(container);

        const elementByTurnId = new Map<string, HTMLElement>();
        const registerTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            elementByTurnId.set(turnId, node);
            spy.register(node, turnId);
            return true;
        };
        const unregisterTurnNode = (node: HTMLElement) => {
            const turnId = node.dataset.turnId;
            if (!turnId) return false;
            if (elementByTurnId.get(turnId) !== node) return false;
            elementByTurnId.delete(turnId);
            spy.unregister(turnId);
            return true;
        };
        const collectTurnNodes = (node: Node): HTMLElement[] => {
            if (!(node instanceof HTMLElement)) return [];
            const collected: HTMLElement[] = [];
            if (node.matches('[data-turn-id]')) collected.push(node);
            node.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((el) => collected.push(el));
            return collected;
        };

        container.querySelectorAll<HTMLElement>('[data-turn-id]').forEach(registerTurnNode);
        spy.markDirty();

        const mutationObserver = new MutationObserver((records) => {
            let changed = false;
            records.forEach((record) => {
                if (record.target instanceof HTMLElement && record.target.closest('[data-turn-id]')) {
                    return;
                }
                record.removedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (unregisterTurnNode(turnNode)) changed = true;
                    });
                });
                record.addedNodes.forEach((node) => {
                    collectTurnNodes(node).forEach((turnNode) => {
                        if (registerTurnNode(turnNode)) changed = true;
                    });
                });
            });
            if (changed) spy.markDirty();
        });
        mutationObserver.observe(container, { subtree: true, childList: true });

        const onScroll = () => spy.onScroll();
        container.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            mutationObserver.disconnect();
            spy.destroy();
        };
    }, [containerEl, onActiveTurnChange, state, sessionIsWorking]);

    return {
        scrollRef,
        state,
        isPinned: state === 'following',
        isOverflowing,
        isFollowingProgrammatically,
        showScrollButton,
        notifyContentChange,
        getAnimationHandlers,
        goToBottom,
        releaseAutoFollow,
        saveSnapshotNow,
        restoreSnapshot,
    };
};
