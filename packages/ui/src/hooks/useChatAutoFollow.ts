import React from 'react';

import { MessageFreshnessDetector } from '@/lib/messageFreshness';
import { createScrollSpy } from '@/components/chat/lib/scroll/scrollSpy';
import { useViewportStore } from '@/sync/viewport-store';

type AutoFollowState = 'following' | 'released';

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
    messageListRef?: React.RefObject<unknown>;
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
    scrollToBottomOnSend: () => void;
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
const SETTLE_BURST_DURATION_MS = 280;
const REPIN_GRACE_AFTER_RELEASE_MS = 1200;

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
    messageListRef: _messageListRef,
    onActiveTurnChange,
}: UseChatAutoFollowOptions): UseChatAutoFollowResult => {
    void _messageListRef;
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
    const lastScrollTopRef = React.useRef(0);
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const repinGraceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSaveRef = React.useRef<{ sessionId: string; anchor: number } | null>(null);
    const settleBurstRafRef = React.useRef<number | null>(null);
    const contentChangeFrameRef = React.useRef<number | null>(null);
    const lastUserReleaseAtRef = React.useRef(0);
    // When restoreSnapshot is invoked while ChatViewport is still hydrating
    // (skeleton rendered, no scroll container yet), we record the session here
    // so a follow-up effect can replay the restore once the container mounts.
    const pendingInitialRestoreRef = React.useRef<string | null>(null);

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
        // Only the active scroll-writer owns the "programmatic follow" flag. If the
        // settle burst is still running it remains the owner, so don't clear here.
        if (settleBurstRafRef.current === null) {
            setIsFollowingProgrammatically(false);
        }
    }, []);

    const stopSettleBurst = React.useCallback(() => {
        if (settleBurstRafRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(settleBurstRafRef.current);
        }
        settleBurstRafRef.current = null;
        if (followRafRef.current === null) {
            setIsFollowingProgrammatically(false);
        }
    }, []);

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
        if (stateRef.current !== 'following') return;
        // Single-writer invariant, asymmetric on purpose: the settle burst is the
        // AUTHORITATIVE instant pin (session restore / goToBottom 'instant'). While
        // it is snapping to the bottom, YIELD — never preempt it with the easing
        // follow loop. Preempting it let a content-measurement ResizeObserver tick
        // downgrade an instant restore into a visible smooth scroll from a mid
        // position when entering a historical session. When the burst ends, the
        // next content kick starts the follow loop. (startSettleBurst still stops
        // this loop, so the two never write scrollTop in the same frame.)
        if (settleBurstRafRef.current !== null) return;
        if (followRafRef.current !== null) return;
        settledFramesRef.current = 0;
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

    const startSettleBurst = React.useCallback(() => {
        if (typeof window === 'undefined') return;
        // Single-writer invariant (mirror of startFollowLoop): the settle burst is
        // taking over scroll ownership, so stop the easing follow loop first. The
        // two must never write scrollTop in the same frame.
        stopFollowLoop();
        stopSettleBurst();
        setIsFollowingProgrammatically(true);
        const until = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + SETTLE_BURST_DURATION_MS;
        const finish = () => {
            settleBurstRafRef.current = null;
            if (followRafRef.current === null) {
                setIsFollowingProgrammatically(false);
            }
        };
        const tick = () => {
            settleBurstRafRef.current = null;
            if (stateRef.current !== 'following') {
                finish();
                return;
            }
            const c = scrollRef.current;
            if (!c) {
                finish();
                return;
            }
            const target = Math.max(0, c.scrollHeight - c.clientHeight);
            if (Math.abs(c.scrollTop - target) > SETTLE_EPSILON) {
                markProgrammaticWrite();
                c.scrollTop = target;
                lastScrollTopRef.current = target;
            }
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (now < until) {
                settleBurstRafRef.current = window.requestAnimationFrame(tick);
            } else {
                finish();
            }
        };
        settleBurstRafRef.current = window.requestAnimationFrame(tick);
    }, [markProgrammaticWrite, stopFollowLoop, stopSettleBurst]);

    const releaseAutoFollow = React.useCallback(() => {
        stopFollowLoop();
        stopSettleBurst();
        cancelRepinGraceTimer();
        lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setStateValue('released');
    }, [cancelRepinGraceTimer, setStateValue, stopFollowLoop, stopSettleBurst]);

    const releaseFromUserIntent = React.useCallback(() => {
        cancelRepinGraceTimer();
        if (stateRef.current === 'following') {
            stopFollowLoop();
            stopSettleBurst();
            lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
            setStateValue('released');
        } else {
            lastUserReleaseAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        }
    }, [cancelRepinGraceTimer, setStateValue, stopFollowLoop, stopSettleBurst]);

    const goToBottom = React.useCallback((mode: 'instant' | 'smooth' = 'instant') => {
        const container = scrollRef.current;
        setStateValue('following');
        lastUserReleaseAtRef.current = 0;
        cancelRepinGraceTimer();
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
        startSettleBurst();
    }, [cancelRepinGraceTimer, markProgrammaticWrite, setStateValue, startSettleBurst, stopFollowLoop, stopSettleBurst, writeScrollTopInstant]);

    const scrollToBottomOnSend = React.useCallback(() => {
        // Keep a SINGLE movement to the just-sent message.
        // If we're already following the bottom, the optimistic message is eased
        // into view by the follow loop (kicked by the content ResizeObserver). Just
        // (re)kick that one owner — do NOT also fire an instant goToBottom here, or
        // the instant snap races the easing loop and you see a visible double scroll
        // (ease, then snap).
        if (stateRef.current === 'following') {
            startFollowLoop();
            return;
        }
        // Scrolled up (released): bring the user down to the message they just sent.
        goToBottom('instant');
    }, [goToBottom, startFollowLoop]);

    const flushSave = React.useCallback(() => {
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current;
        if (!pending) return;
        const container = scrollRef.current;
        if (!container) {
            pendingSaveRef.current = null;
            return;
        }
        updateViewportAnchor(pending.sessionId, pending.anchor, {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
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

        pendingSaveRef.current = { sessionId, anchor };
        if (saveTimerRef.current !== null) return;
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            flushSave();
        }, SAVE_DEBOUNCE_MS);
    }, [flushSave]);

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

        // Always return to the bottom on session switch. The previous saved-ratio
        // restore had a low success rate and, by landing 'released' partway up,
        // produced the visible backward jump as content finished loading.
        setStateValue('following');
        lastUserReleaseAtRef.current = 0;
        cancelRepinGraceTimer();
        const target = Math.max(0, container.scrollHeight - container.clientHeight);
        // Mirror goToBottom('instant'): jump to the bottom now, then hold it with the
        // settle burst while late history content measures in. Do NOT also start the
        // easing follow loop here — that is what produced the smooth scroll-from-mid
        // position on session entry.
        writeScrollTopInstant(target);
        startSettleBurst();
        return false;
    }, [cancelRepinGraceTimer, setStateValue, startSettleBurst, writeScrollTopInstant]);

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
        markProgrammaticWrite();
        // Drop any pending restore request inherited from a different session.
        if (pendingInitialRestoreRef.current && pendingInitialRestoreRef.current !== currentSessionId) {
            pendingInitialRestoreRef.current = null;
        }
    }, [cancelRepinGraceTimer, currentSessionId, flushSave, markProgrammaticWrite, stopFollowLoop, stopSettleBurst]);

    React.useEffect(() => {
        if (sessionIsWorking && stateRef.current === 'following') {
            startFollowLoop();
        }
    }, [sessionIsWorking, startFollowLoop]);

    // Replay a deferred restoreSnapshot once ChatViewport mounts.
    // useLayoutEffect ensures scroll position is set before the browser paints,
    // preventing a visible flash of content at the wrong scroll position.
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

        // Release auto-follow only when the user has actually left the near-bottom
        // zone — not on the small scrollTop clamp the browser applies when the
        // composer grows and shrinks the viewport (which keeps you at the bottom).
        // Position-based, mirroring the re-pin check below; this removes the false
        // release that produced the visible backward jump on session switch.
        if (stateRef.current === 'following' && !isNearBottom(container, isMobile)) {
            stopFollowLoop();
            stopSettleBurst();
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
            flushSave();
            if (saveTimerRef.current !== null) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [cancelRepinGraceTimer, flushSave, stopContentChangeFrame, stopFollowLoop, stopSettleBurst]);

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
        scrollToBottomOnSend,
        releaseAutoFollow,
        saveSnapshotNow,
        restoreSnapshot,
    };
};
