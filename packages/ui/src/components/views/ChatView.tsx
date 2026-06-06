import React from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ChatErrorBoundary } from '@/components/chat/ChatErrorBoundary';
import { useSessionUIStore } from '@/sync/session-ui-store';

type ChatViewProps = {
    readOnly?: boolean;
    autoOpenDraft?: boolean;
};

export const ChatView: React.FC<ChatViewProps> = ({ readOnly = false, autoOpenDraft = true }) => {
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);

    return (
        <ChatErrorBoundary sessionId={currentSessionId || undefined}>
            <ChatContainer readOnly={readOnly} autoOpenDraft={autoOpenDraft} />
        </ChatErrorBoundary>
    );
};
