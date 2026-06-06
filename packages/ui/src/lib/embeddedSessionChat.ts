export type EmbeddedSessionChatConfig = {
  sessionId: string;
  directory: string | null;
  readOnly: boolean;
};

const EMBEDDED_SESSION_CHAT_PANEL = 'session-chat';

export const readEmbeddedSessionChatConfigFromParams = (params: URLSearchParams): EmbeddedSessionChatConfig | null => {
  if (params.get('ocPanel') !== EMBEDDED_SESSION_CHAT_PANEL) {
    return null;
  }

  const sessionIdRaw = params.get('sessionId');
  const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : '';
  if (!sessionId) {
    return null;
  }

  const directoryRaw = params.get('directory');
  const directory = typeof directoryRaw === 'string' && directoryRaw.trim().length > 0
    ? directoryRaw.trim()
    : null;

  return {
    sessionId,
    directory,
    readOnly: params.get('readOnly') === '1' || params.get('readOnly') === 'true',
  };
};

export const readEmbeddedSessionChatConfigFromSearch = (search: string): EmbeddedSessionChatConfig | null => {
  return readEmbeddedSessionChatConfigFromParams(new URLSearchParams(search));
};

export const readEmbeddedSessionChatConfig = (): EmbeddedSessionChatConfig | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return readEmbeddedSessionChatConfigFromSearch(window.location.search);
};

export const shouldConsumeSessionUrlParams = (params: URLSearchParams): boolean => {
  if (params.get('ocPanel') === EMBEDDED_SESSION_CHAT_PANEL) {
    return false;
  }

  const sessionId = (params.get('session') ?? params.get('sessionId') ?? '').trim();
  return sessionId.length > 0;
};
