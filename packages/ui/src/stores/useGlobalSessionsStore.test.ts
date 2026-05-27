import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { create } from 'zustand';

const buildSession = (shareUrl: string): Session => ({
  id: 'ses_1',
  title: 'Shared session',
  time: { created: 1, updated: 2 },
  share: { url: shareUrl },
} as Session);

describe('useGlobalSessionsStore', () => {
  const useGlobalSessionsStore = create<{
    activeSessions: Session[];
    archivedSessions: Session[];
    sessionsByDirectory: Map<string, Session[]>;
    hasLoaded: boolean;
    status: string;
    upsertSession: (session: Session) => void;
  }>((set) => ({
    activeSessions: [],
    archivedSessions: [],
    sessionsByDirectory: new Map(),
    hasLoaded: false,
    status: 'idle',
    upsertSession: (session) => set((state) => {
      const index = state.activeSessions.findIndex((candidate) => candidate.id === session.id);
      if (index === -1) {
        return { activeSessions: [session, ...state.activeSessions] };
      }
      const next = [...state.activeSessions];
      next[index] = session;
      return { activeSessions: next };
    }),
  }));

  beforeEach(() => {
    useGlobalSessionsStore.setState({
      activeSessions: [],
      archivedSessions: [],
      sessionsByDirectory: new Map(),
      hasLoaded: false,
      status: 'idle',
    });
  });

  test('updates an existing session when the share URL changes', () => {
    useGlobalSessionsStore.getState().upsertSession(buildSession('https://share.example/a'));
    useGlobalSessionsStore.getState().upsertSession(buildSession('https://share.example/b'));

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.share?.url).toBe('https://share.example/b');
  });
});
