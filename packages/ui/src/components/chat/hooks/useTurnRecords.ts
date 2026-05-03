import React from 'react';
import { projectTurnRecords } from '../lib/turns/projectTurnRecords';
import type { ChatMessageEntry, TurnProjectionResult, TurnRecord } from '../lib/turns/types';
import { streamPerfMeasure } from '@/stores/utils/streamDebug';

interface UseTurnRecordsOptions {
    sessionKey?: string;
    showTextJustificationActivity: boolean;
}

export interface TurnRecordsResult {
    projection: TurnProjectionResult;
    staticTurns: TurnProjectionResult['turns'];
    streamingTurn: TurnProjectionResult['turns'][number] | undefined;
    trailingUngroupedMessageId?: string;
}

export const splitTurnProjectionForStreaming = (
    projection: TurnProjectionResult,
    messages: ChatMessageEntry[],
): Pick<TurnRecordsResult, 'staticTurns' | 'streamingTurn' | 'trailingUngroupedMessageId'> => {
    const lastTurn = projection.turns[projection.turns.length - 1];
    if (!lastTurn) {
        const lastMessage = messages[messages.length - 1];
        return {
            staticTurns: [],
            streamingTurn: undefined,
            trailingUngroupedMessageId: lastMessage && projection.ungroupedMessageIds.has(lastMessage.info.id)
                ? lastMessage.info.id
                : undefined,
        };
    }

    const lastMessage = messages[messages.length - 1];
    const lastMessageTurnId = lastMessage
        ? projection.indexes.messageToTurnId.get(lastMessage.info.id)
        : undefined;
    if (lastMessageTurnId !== lastTurn.turnId) {
        return {
            staticTurns: projection.turns,
            streamingTurn: undefined,
            trailingUngroupedMessageId: lastMessage && projection.ungroupedMessageIds.has(lastMessage.info.id)
                ? lastMessage.info.id
                : undefined,
        };
    }

    return {
        staticTurns: projection.turns.length <= 1 ? [] : projection.turns.slice(0, -1),
        streamingTurn: lastTurn,
        trailingUngroupedMessageId: undefined,
    };
};

export const useTurnRecords = (
    messages: ChatMessageEntry[],
    options: UseTurnRecordsOptions,
): TurnRecordsResult => {
    const previousProjectionRef = React.useRef<TurnProjectionResult | null>(null);
    const staticTurnsRef = React.useRef<TurnRecord[]>([]);
    const streamingTurnRef = React.useRef<TurnRecord | undefined>(undefined);
    const previousSessionKeyRef = React.useRef<string | undefined>(options.sessionKey);

    if (previousSessionKeyRef.current !== options.sessionKey) {
        previousSessionKeyRef.current = options.sessionKey;
        previousProjectionRef.current = null;
        staticTurnsRef.current = [];
        streamingTurnRef.current = undefined;
    }

    React.useEffect(() => {
        previousProjectionRef.current = null;
        staticTurnsRef.current = [];
        streamingTurnRef.current = undefined;
    }, [options.sessionKey, options.showTextJustificationActivity]);

    const projection = React.useMemo(() => {
        return streamPerfMeasure('ui.turns.projection_ms', () => {
            const nextProjection = projectTurnRecords(messages, {
                previousProjection: previousProjectionRef.current,
                showTextJustificationActivity: options.showTextJustificationActivity,
            });
            previousProjectionRef.current = nextProjection;
            return nextProjection;
        });
    }, [messages, options.showTextJustificationActivity]);

    const splitProjection = React.useMemo(
        () => splitTurnProjectionForStreaming(projection, messages),
        [messages, projection],
    );

    const staticTurns = React.useMemo(() => {
        const nextStatic = splitProjection.staticTurns;
        const previousStatic = staticTurnsRef.current;

        if (previousStatic.length === nextStatic.length) {
            let isSame = true;
            for (let index = 0; index < nextStatic.length; index += 1) {
                if (previousStatic[index] !== nextStatic[index]) {
                    isSame = false;
                    break;
                }
            }
            if (isSame) {
                return previousStatic;
            }
        }

        staticTurnsRef.current = nextStatic;
        return nextStatic;
    }, [splitProjection.staticTurns]);

    const streamingTurn = React.useMemo(() => {
        const nextStreamingTurn = splitProjection.streamingTurn;
        if (streamingTurnRef.current === nextStreamingTurn) {
            return streamingTurnRef.current;
        }
        streamingTurnRef.current = nextStreamingTurn;
        return nextStreamingTurn;
    }, [splitProjection.streamingTurn]);

    return {
        projection,
        staticTurns,
        streamingTurn,
        trailingUngroupedMessageId: splitProjection.trailingUngroupedMessageId,
    };
};
