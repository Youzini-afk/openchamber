import React from 'react';

import type { ChatMessageEntry } from '../lib/turns/types';
import type { MessageListHandle } from '../MessageList';
import {
    buildTurnWindowModel,
    updateTurnWindowModelIncremental,
    type TurnWindowModel,
} from '../lib/turns/windowTurns';
import type { TurnHistorySignals } from '../lib/turns/historySignals';
import { getMemoryLimits, type SessionHistoryMeta } from '@/stores/types/sessionTypes';
import { isVSCodeRuntime } from '@/lib/desktop';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { isProgressiveMountInFlight } from '@/sync/use-sync';

type ViewportAnchor = { messageId: string; offsetTop: number };

type PendingScrollRequest = {
    sessionId: string;
    kind: 'turn' | 'message';
    id: string;
    behavior: ScrollBehavior;
    turnId: string | null;
    resolve: (value: boolean) => void;
};

interface UseChatTimelineControllerOptions {
    sessionId: string | null;
    messages: ChatMessageEntry[];
    historyMeta: SessionHistoryMeta | null;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    messageListRef: React.RefObject<MessageListHandle | null>;
    loadMoreMessages: (sessionId: string, direction: 'up' | 'down') => Promise<void>;
    goToBottom: (mode?: 'instant' | 'smooth') => void;
    releaseAutoFollow: () => void;
    isPinned: boolean;
    showScrollButton: boolean;
}

export interface UseChatTimelineControllerResult {
    turnIds: string[];
    turnStart: number;
    renderedMessages: ChatMessageEntry[];
    historySignals: TurnHistorySignals;
    isLoadingOlder: boolean;
    pendingRevealWork: boolean;
    activeTurnId: string | null;
    showScrollToBottom: boolean;
    turnWindowModel: TurnWindowModel;
    loadEarlier: (options?: { userInitiated?: boolean }) => Promise<void>;
    revealBufferedTurns: () => Promise<boolean>;
    resumeToBottom: () => void;
    resumeToBottomInstant: () => Promise<void>;
    scrollToTurn: (turnId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior }) => Promise<boolean>;
    handleHistoryScroll: () => void;
    captureViewportAnchor: () => ViewportAnchor | null;
    restoreViewportAnchor: (anchor: ViewportAnchor) => boolean;
    handleActiveTurnChange: (turnId: string | null) => void;
}

const TURN_MODEL_CACHE_MAX = 30
const HISTORY_SCROLL_THRESHOLD = 200
const VSCODE_TURN_MODEL_CACHE_MAX = 4
const VSCODE_TURN_MODEL_CACHE_MAX_MESSAGES = 30
const MOBILE_TURN_MODEL_CACHE_MAX = 4
const MOBILE_TURN_MODEL_CACHE_MAX_MESSAGES = 30
const HISTORY_RENDER_WAIT_TIMEOUT_MS = 250
const HISTORY_INTERACTION_GUARD_MS = 2000
const turnModelCache = new Map<string, { messages: ChatMessageEntry[]; model: TurnWindowModel }>()
const getTurnModelCacheMax = () => {
    if (isVSCodeRuntime()) return VSCODE_TURN_MODEL_CACHE_MAX
    if (isMobileSurfaceRuntime()) return MOBILE_TURN_MODEL_CACHE_MAX
    return TURN_MODEL_CACHE_MAX
}

const shouldCacheTurnModelMessages = (messages: ChatMessageEntry[]): boolean => {
    if (isVSCodeRuntime()) return messages.length <= VSCODE_TURN_MODEL_CACHE_MAX_MESSAGES
    if (isMobileSurfaceRuntime()) return messages.length <= MOBILE_TURN_MODEL_CACHE_MAX_MESSAGES
    return true
}

const rememberTurnModel = (key: string, value: { messages: ChatMessageEntry[]; model: TurnWindowModel }) => {
    turnModelCache.delete(key)
    if (!shouldCacheTurnModelMessages(value.messages)) {
        return
    }
    const max = getTurnModelCacheMax()
    while (turnModelCache.size >= max) {
        const oldest = turnModelCache.keys().next().value
        if (typeof oldest !== 'string') break
        turnModelCache.delete(oldest)
    }
    turnModelCache.set(key, value)
}

export const shouldAutoLoadEarlierForUnderfilledPinnedViewport = (input: {
    sessionId: string | null;
    isPinned: boolean;
    canLoadEarlier: boolean;
    isLoadingOlder: boolean;
    pendingRevealWork: boolean;
    scrollHeight: number;
    clientHeight: number;
}): boolean => {
    if (!input.sessionId) return false;
    if (!input.isPinned || !input.canLoadEarlier) return false;
    if (input.isLoadingOlder || input.pendingRevealWork) return false;
    return input.scrollHeight <= input.clientHeight + 1;
};

export const shouldLoadEarlierFromHistoryScroll = (input: {
    sessionId: string | null;
    isPinned: boolean;
    scrollTop: number;
    threshold: number;
    canLoadEarlier: boolean;
    isLoadingOlder: boolean;
    pendingRevealWork: boolean;
    historyInteractionActive: boolean;
    progressiveMountInFlight: boolean;
}): boolean => {
    if (!input.sessionId) return false;
    if (input.isPinned) return false;
    if (input.historyInteractionActive || input.progressiveMountInFlight) return false;
    if (input.scrollTop >= input.threshold) return false;
    if (!input.canLoadEarlier) return false;
    if (input.isLoadingOlder || input.pendingRevealWork) return false;
    return true;
};

export const useChatTimelineController = ({
    sessionId,
    messages,
    historyMeta,
    scrollRef,
    messageListRef,
    loadMoreMessages,
    goToBottom,
    releaseAutoFollow,
    isPinned,
    showScrollButton,
}: UseChatTimelineControllerOptions): UseChatTimelineControllerResult => {
    const previousTurnWindowModelRef = React.useRef<TurnWindowModel | null>(null);
    const previousMessagesRef = React.useRef<ChatMessageEntry[] | null>(null);
    const turnWindowModel = React.useMemo(() => {
        const key = sessionId ?? ""
        const cached = key ? turnModelCache.get(key) : undefined
        // Loose cache hit: same length + same first/last message id. The
        // previous strict check (cached.messages === messages) required exact
        // reference equality, which almost never holds because each render
        // creates a new messages array from the store — so the cache was
        // effectively dead code. The loose check catches the streaming case
        // (last message's parts grow but its id/role/parent stay the same)
        // and lets updateTurnWindowModelIncremental refresh the model in
        // O(delta) instead of rebuilding O(N) on every frame.
        if (cached && cached.messages.length === messages.length && messages.length > 0) {
            const cachedFirstId = cached.messages[0]?.info?.id ?? null
            const cachedLastId = cached.messages[cached.messages.length - 1]?.info?.id ?? null
            const currentFirstId = messages[0]?.info?.id ?? null
            const currentLastId = messages[messages.length - 1]?.info?.id ?? null
            if (cachedFirstId === currentFirstId && cachedLastId === currentLastId) {
                const incrementalModel = updateTurnWindowModelIncremental(
                    cached.model,
                    cached.messages,
                    messages,
                )
                if (incrementalModel) {
                    rememberTurnModel(key, { messages, model: incrementalModel })
                    previousTurnWindowModelRef.current = incrementalModel
                    previousMessagesRef.current = messages
                    return incrementalModel
                }
                // updateTurnWindowModelIncremental returned null — interior
                // changes it can't handle. Fall through to the full rebuild.
            }
        }

        const incrementalModel = updateTurnWindowModelIncremental(
            previousTurnWindowModelRef.current,
            previousMessagesRef.current,
            messages,
        );
        const nextModel = incrementalModel ?? buildTurnWindowModel(messages);
        previousTurnWindowModelRef.current = nextModel;
        previousMessagesRef.current = messages;

        if (key && messages.length > 0) {
            rememberTurnModel(key, { messages, model: nextModel })
        }

        return nextModel;
    }, [messages, sessionId]);

    const [isLoadingOlder, setIsLoadingOlder] = React.useState(false);
    const [pendingRevealWork, setPendingRevealWork] = React.useState(false);
    const [activeTurnId, setActiveTurnId] = React.useState<string | null>(null);

    const turnModelRef = React.useRef(turnWindowModel);
    const isPinnedRef = React.useRef(isPinned);
    const isLoadingOlderRef = React.useRef(isLoadingOlder);
    const pendingRevealWorkRef = React.useRef(pendingRevealWork);
    const sessionIdRef = React.useRef<string | null>(sessionId);
    const messagesRef = React.useRef(messages);
    const historyMetaRef = React.useRef<SessionHistoryMeta | null>(historyMeta);
    const initializedSessionRef = React.useRef<string | null>(null);
    const pendingRenderResolversRef = React.useRef<Array<() => void>>([]);
    const pendingScrollRequestRef = React.useRef<PendingScrollRequest | null>(null);
    const historyInteractionRef = React.useRef(false);
    const historyInteractionTimerRef = React.useRef<number | null>(null);

    const historySignals = React.useMemo(() => {
        const defaultLimit = getMemoryLimits().HISTORICAL_MESSAGES;
        const hasBufferedTurns = false;
        const hasMoreAboveTurns = historyMeta
            ? !historyMeta.complete
            : messages.length >= defaultLimit;
        const historyLoading = Boolean(historyMeta?.loading);
        return {
            hasBufferedTurns,
            hasMoreAboveTurns,
            historyLoading,
            canLoadEarlier: hasMoreAboveTurns,
        };
    }, [historyMeta, messages.length]);

    const historySignalsRef = React.useRef(historySignals);

    turnModelRef.current = turnWindowModel;
    isPinnedRef.current = isPinned;
    isLoadingOlderRef.current = isLoadingOlder;
    pendingRevealWorkRef.current = pendingRevealWork;
    historySignalsRef.current = historySignals;
    sessionIdRef.current = sessionId;
    messagesRef.current = messages;
    historyMetaRef.current = historyMeta;

    const beginHistoryInteraction = React.useCallback(() => {
        historyInteractionRef.current = true;
        if (historyInteractionTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(historyInteractionTimerRef.current);
            historyInteractionTimerRef.current = null;
        }
    }, []);

    const settleHistoryInteraction = React.useCallback(() => {
        if (typeof window === 'undefined') {
            historyInteractionRef.current = false;
            return;
        }

        if (historyInteractionTimerRef.current !== null) {
            window.clearTimeout(historyInteractionTimerRef.current);
        }
        historyInteractionTimerRef.current = window.setTimeout(() => {
            historyInteractionTimerRef.current = null;
            historyInteractionRef.current = false;
        }, HISTORY_INTERACTION_GUARD_MS);
    }, []);

    React.useLayoutEffect(() => {
        if (initializedSessionRef.current === sessionId) {
            return;
        }
        if (historyInteractionTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(historyInteractionTimerRef.current);
            historyInteractionTimerRef.current = null;
        }
        historyInteractionRef.current = false;
        initializedSessionRef.current = sessionId;
        setIsLoadingOlder(false);
        setPendingRevealWork(false);
        setActiveTurnId(null);
    }, [sessionId]);

    const resolvePendingRenderWaiters = React.useCallback(() => {
        const resolvers = pendingRenderResolversRef.current;
        if (resolvers.length === 0) {
            return;
        }
        pendingRenderResolversRef.current = [];
        resolvers.forEach((resolve) => resolve());
    }, []);

    const waitForNextRenderCommitOrTimeout = React.useCallback((): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (typeof window === 'undefined') {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve();
            };
            pendingRenderResolversRef.current.push(finish);
            const timer = window.setTimeout(finish, HISTORY_RENDER_WAIT_TIMEOUT_MS);
        });
    }, []);

    const resolvePendingScrollRequest = React.useCallback((value: boolean) => {
        const pending = pendingScrollRequestRef.current;
        if (!pending) {
            return;
        }
        pendingScrollRequestRef.current = null;
        pending.resolve(value);
    }, []);

    const attemptPendingScrollRequest = React.useCallback(() => {
        const pending = pendingScrollRequestRef.current;
        if (!pending) {
            return;
        }

        if (pending.sessionId !== sessionIdRef.current) {
            resolvePendingScrollRequest(false);
            return;
        }

        const didScroll = pending.kind === 'turn'
            ? (messageListRef.current?.scrollToTurnId(pending.id, { behavior: pending.behavior }) ?? false)
            : (messageListRef.current?.scrollToMessageId(pending.id, { behavior: pending.behavior }) ?? false);

        if (didScroll) {
            if (pending.turnId) {
                setActiveTurnId(pending.turnId);
            }
            resolvePendingScrollRequest(true);
            return;
        }

        const targetIndex = pending.kind === 'turn'
            ? turnModelRef.current.turnIndexById.get(pending.id)
            : turnModelRef.current.messageToTurnIndex.get(pending.id);

        if (typeof targetIndex === 'number') {
            resolvePendingScrollRequest(false);
        }
    }, [messageListRef, resolvePendingScrollRequest]);

    React.useEffect(() => {
        return () => {
            if (historyInteractionTimerRef.current !== null && typeof window !== 'undefined') {
                window.clearTimeout(historyInteractionTimerRef.current);
                historyInteractionTimerRef.current = null;
            }
            resolvePendingRenderWaiters();
            resolvePendingScrollRequest(false);
        };
    }, [resolvePendingRenderWaiters, resolvePendingScrollRequest]);

    const renderedMessages = messages;

    React.useLayoutEffect(() => {
        resolvePendingRenderWaiters();
        attemptPendingScrollRequest();
    }, [attemptPendingScrollRequest, renderedMessages, resolvePendingRenderWaiters]);

    // --- Synchronous scroll compensation for load-more / reveal ---
    // fetchOlderHistory and revealBufferedTurns store a snapshot here
    // before triggering the state change. useLayoutEffect consumes it
    // after React commits new DOM — before the browser paints.
    const prePrependScrollRef = React.useRef<{
        height: number;
        top: number;
        anchor: ViewportAnchor | null;
    } | null>(null);

    const captureViewportAnchor = React.useCallback((): ViewportAnchor | null => {
        return messageListRef.current?.captureViewportAnchor() ?? null;
    }, [messageListRef]);

    const restoreViewportAnchor = React.useCallback((anchor: ViewportAnchor): boolean => {
        return messageListRef.current?.restoreViewportAnchor(anchor) ?? false;
    }, [messageListRef]);

    // Tracks the timeline edges + height of the previous commit so a prepend
    // that did NOT go through fetchOlderHistory (e.g. the background history
    // prepend dispatched from useSync) can be compensated too. With
    // overflow-anchor:none the browser leaves scrollTop unchanged when content
    // is inserted above, so without this the viewport visibly jumps and
    // auto-follow yanks it back on the next frame — a one-shot up/down judder.
    const prependTrackingRef = React.useRef<{
        oldestId: string | null;
        newestId: string | null;
        scrollHeight: number;
        sessionId: string | null;
    } | null>(null);

    React.useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const currentOldestId = renderedMessages[0]?.info?.id ?? null;
        const currentNewestId = renderedMessages[renderedMessages.length - 1]?.info?.id ?? null;

        const snap = prePrependScrollRef.current;
        if (snap) {
            prePrependScrollRef.current = null;
            // When a viewport anchor is available, delegate to MessageList
            // restoreViewportAnchor which falls back to virtualizer-aware
            // scrollHistoryIndexIntoView when the element is not in the DOM.
            if (!(snap.anchor && restoreViewportAnchor(snap.anchor))) {
                // Fallback: height-delta compensation
                const delta = container.scrollHeight - snap.height;
                if (delta > 0) {
                    container.scrollTop = snap.top + delta;
                }
            }
        } else {
            // Auto-detect a prepend by the oldest message id changing WITHIN
            // the same session. We no longer require the newest id to be
            // unchanged: when streaming and prepend land in the same commit,
            // newestId also changes and the old guard would skip compensation
            // — leaving the viewport visibly jumped up until auto-follow
            // yanked it back on the next frame (a one-shot up/down judder).
            // Instead, compensate by the height delta whenever a prepend is
            // detected within the same session, regardless of whether the
            // tail also grew. The full delta includes any streaming tail
            // growth; for a bottom-pinned viewport auto-follow re-clamps on
            // the next frame anyway, and for a released viewport the small
            // over-compensation (tail growth) is far less jarring than the
            // large under-compensation (whole prepend page) of skipping.
            const prev = prependTrackingRef.current;
            const isPrepend = Boolean(
                prev
                && prev.oldestId
                && currentOldestId
                && currentOldestId !== prev.oldestId
                && prev.sessionId === sessionIdRef.current,
            );
            if (isPrepend && prev) {
                const delta = container.scrollHeight - prev.scrollHeight;
                if (delta > 0) {
                    container.scrollTop = container.scrollTop + delta;
                }
            }
        }

        prependTrackingRef.current = {
            oldestId: currentOldestId,
            newestId: currentNewestId,
            scrollHeight: container.scrollHeight,
            sessionId: sessionIdRef.current,
        };
    }, [renderedMessages, scrollRef, restoreViewportAnchor]);

    const revealBufferedTurns = React.useCallback(async (): Promise<boolean> => false, []);

    const fetchOlderHistory = React.useCallback(async (input: {
        preserveViewport: boolean;
    }): Promise<boolean> => {
        if (!sessionIdRef.current || isLoadingOlderRef.current) {
            return false;
        }
        if (!historySignalsRef.current.hasMoreAboveTurns) {
            return false;
        }

        const container = scrollRef.current;
        const beforeMessages = messagesRef.current;
        const beforeMessageCount = beforeMessages.length;
        const beforeOldestMessageId = beforeMessages[0]?.info?.id ?? null;
        const beforeLimit = historyMetaRef.current?.limit ?? getMemoryLimits().HISTORICAL_MESSAGES;

        // Store scroll snapshot BEFORE the fetch so useLayoutEffect can
        // compensate synchronously when React commits the new messages.
        if (input.preserveViewport && container) {
            prePrependScrollRef.current = {
                height: container.scrollHeight,
                top: container.scrollTop,
                anchor: captureViewportAnchor(),
            };
        }

        beginHistoryInteraction();
        setIsLoadingOlder(true);

        try {
            const targetSessionId = sessionIdRef.current;
            if (!targetSessionId) {
                return false;
            }

            let loadedMessageCount = beforeMessageCount;
            let loadedOldestMessageId = beforeOldestMessageId;
            let loadedLimit = beforeLimit;
            const beforeTurnCount = turnModelRef.current.turnCount;

            while (true) {
                await loadMoreMessages(targetSessionId, 'up');
                if (sessionIdRef.current !== targetSessionId) {
                    return false;
                }

                await waitForNextRenderCommitOrTimeout();

                const afterMessages = messagesRef.current;
                const afterMessageCount = afterMessages.length;
                const afterOldestMessageId = afterMessages[0]?.info?.id ?? null;
                const afterLimit = historyMetaRef.current?.limit ?? loadedLimit;
                const messageGrowth =
                    afterMessageCount > loadedMessageCount
                    || (typeof loadedOldestMessageId === 'string'
                        && typeof afterOldestMessageId === 'string'
                        && loadedOldestMessageId !== afterOldestMessageId)
                    || afterLimit > loadedLimit;
                const turnGrowth = turnModelRef.current.turnCount - beforeTurnCount;

                if (turnGrowth > 0) {
                    return true;
                }
                if (!messageGrowth) {
                    return false;
                }
                if (!historySignalsRef.current.hasMoreAboveTurns) {
                    return true;
                }

                loadedMessageCount = afterMessageCount;
                loadedOldestMessageId = afterOldestMessageId;
                loadedLimit = afterLimit;
            }
        } finally {
            setIsLoadingOlder(false);
            settleHistoryInteraction();
        }
    }, [beginHistoryInteraction, captureViewportAnchor, loadMoreMessages, scrollRef, settleHistoryInteraction, waitForNextRenderCommitOrTimeout]);

    const loadEarlier = React.useCallback(async (options?: { userInitiated?: boolean }) => {
        beginHistoryInteraction();
        if (options?.userInitiated) {
            releaseAutoFollow();
        }

        try {
            void (await fetchOlderHistory({ preserveViewport: true }));
        } finally {
            settleHistoryInteraction();
        }
    }, [beginHistoryInteraction, fetchOlderHistory, releaseAutoFollow, settleHistoryInteraction]);

    const handleHistoryScroll = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        const currentSession = sessionIdRef.current;
        if (!shouldLoadEarlierFromHistoryScroll({
            sessionId: currentSession,
            isPinned: isPinnedRef.current,
            scrollTop: container.scrollTop,
            threshold: HISTORY_SCROLL_THRESHOLD,
            canLoadEarlier: historySignalsRef.current.canLoadEarlier,
            isLoadingOlder: isLoadingOlderRef.current,
            pendingRevealWork: pendingRevealWorkRef.current,
            historyInteractionActive: historyInteractionRef.current,
            progressiveMountInFlight: currentSession ? isProgressiveMountInFlight(currentSession) : false,
        })) {
            return;
        }

        void loadEarlier({ userInitiated: true });
    }, [loadEarlier, scrollRef]);

    const loadEarlierIfPinnedViewportUnderfilled = React.useCallback(() => {
        if (historyInteractionRef.current) return;
        // Don't compete with a progressive mount that's already prepending
        // older history for this session from useSync. Running both in the
        // same frame produces a double delta application and visible judder.
        if (sessionIdRef.current && isProgressiveMountInFlight(sessionIdRef.current)) return;
        const container = scrollRef.current;
        if (!container) return;
        if (!shouldAutoLoadEarlierForUnderfilledPinnedViewport({
            sessionId: sessionIdRef.current,
            isPinned: isPinnedRef.current,
            canLoadEarlier: historySignalsRef.current.canLoadEarlier,
            isLoadingOlder: isLoadingOlderRef.current,
            pendingRevealWork: pendingRevealWorkRef.current,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
        })) {
            return;
        }

        void loadEarlier();
    }, [loadEarlier, scrollRef]);

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            loadEarlierIfPinnedViewportUnderfilled();
        });

        return () => window.cancelAnimationFrame(frame);
    }, [
        historySignals.canLoadEarlier,
        isLoadingOlder,
        isPinned,
        loadEarlierIfPinnedViewportUnderfilled,
        pendingRevealWork,
        renderedMessages.length,
        sessionId,
    ]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') {
            return;
        }

        const container = scrollRef.current;
        if (!container) {
            return;
        }

        let frame: number | null = null;
        const scheduleCheck = () => {
            if (frame !== null) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = null;
                loadEarlierIfPinnedViewportUnderfilled();
            });
        };

        const observer = new ResizeObserver(scheduleCheck);
        observer.observe(container);
        const content = container.firstElementChild;
        if (content instanceof Element) {
            observer.observe(content);
        }
        scheduleCheck();

        return () => {
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }
            observer.disconnect();
        };
    }, [loadEarlierIfPinnedViewportUnderfilled, scrollRef, sessionId]);

    const scrollToTurn = React.useCallback(async (
        turnId: string,
        options?: { behavior?: ScrollBehavior },
    ): Promise<boolean> => {
        if (!turnId || !sessionIdRef.current) {
            return false;
        }

        releaseAutoFollow();
        setPendingRevealWork(true);

        try {
            if (sessionIdRef.current !== sessionId) {
                return false;
            }

            const turnIndex = turnModelRef.current.turnIndexById.get(turnId);
            if (typeof turnIndex !== 'number') {
                return false;
            }

            const result = await new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'turn',
                    id: turnId,
                    behavior: options?.behavior ?? 'auto',
                    turnId,
                    resolve,
                };
                attemptPendingScrollRequest();
            });

            if (result) {
                return true;
            }

            return false;
        } finally {
            setPendingRevealWork(false);
        }
    }, [attemptPendingScrollRequest, releaseAutoFollow, sessionId]);

    const scrollToMessage = React.useCallback(async (
        messageId: string,
        options?: { behavior?: ScrollBehavior },
    ): Promise<boolean> => {
        if (!messageId || !sessionIdRef.current) {
            return false;
        }

        releaseAutoFollow();
        setPendingRevealWork(true);

        try {
            if (sessionIdRef.current !== sessionId) {
                return false;
            }

            const turnId = turnModelRef.current.messageToTurnId.get(messageId);
            const turnIndex = turnModelRef.current.messageToTurnIndex.get(messageId);

            if (typeof turnIndex !== 'number') {
                return false;
            }

            const result = await new Promise<boolean>((resolve) => {
                pendingScrollRequestRef.current = {
                    sessionId: sessionIdRef.current ?? sessionId ?? '',
                    kind: 'message',
                    id: messageId,
                    behavior: options?.behavior ?? 'auto',
                    turnId: turnId ?? null,
                    resolve,
                };
                attemptPendingScrollRequest();
            });

            if (result) {
                return true;
            }

            return false;
        } finally {
            setPendingRevealWork(false);
        }
    }, [attemptPendingScrollRequest, releaseAutoFollow, sessionId]);

    const resumeToBottom = React.useCallback(async () => {
        setPendingRevealWork(false);
        setIsLoadingOlder(false);
        goToBottom('smooth');
    }, [goToBottom]);

    const resumeToBottomInstant = React.useCallback(async () => {
        setPendingRevealWork(false);
        setIsLoadingOlder(false);
        goToBottom('instant');
    }, [goToBottom]);

    const handleActiveTurnChange = React.useCallback((turnId: string | null) => {
        setActiveTurnId(turnId);
    }, []);

    return {
        turnIds: turnWindowModel.turnIds,
        turnStart: 0,
        renderedMessages,
        historySignals,
        isLoadingOlder,
        pendingRevealWork,
        activeTurnId,
        showScrollToBottom: showScrollButton && !pendingRevealWork,
        turnWindowModel,
        loadEarlier,
        revealBufferedTurns,
        resumeToBottom,
        resumeToBottomInstant,
        scrollToTurn,
        scrollToMessage,
        handleHistoryScroll,
        captureViewportAnchor,
        restoreViewportAnchor,
        handleActiveTurnChange,
    };
};
