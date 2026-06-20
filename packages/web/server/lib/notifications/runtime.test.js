import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationTriggerRuntime } from './runtime.js';

const createRuntime = (overrides = {}) => {
  const sendPushToAllUiSessions = vi.fn(async () => {});
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }));
  const runtime = createNotificationTriggerRuntime({
    readSettingsFromDisk: vi.fn(async () => ({ nativeNotificationsEnabled: false })),
    prepareNotificationLastMessage: vi.fn(async ({ message }) => message),
    buildTemplateVariables: vi.fn(async () => ({})),
    extractLastMessageText: vi.fn(() => ''),
    fetchLastAssistantMessageText: vi.fn(async () => ''),
    resolveNotificationTemplate: vi.fn((template) => template),
    shouldApplyResolvedTemplateMessage: vi.fn(() => false),
    emitDesktopNotification: vi.fn(() => false),
    broadcastUiNotification: vi.fn(),
    sendPushToAllUiSessions,
    sendMobilePushToAllDevices: vi.fn(async () => {}),
    buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    fetchImpl,
    ...overrides,
  });
  return { runtime, fetchImpl, sendPushToAllUiSessions };
};

const permissionAsked = (overrides = {}) => ({
  type: 'permission.asked',
  properties: {
    id: 'perm_1',
    sessionID: 'ses_1',
    directory: '/repo',
    permission: 'bash',
    ...overrides,
  },
});

describe('notification permission auto-accept', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replies to OpenCode when the session has auto-accept enabled', async () => {
    const { runtime, fetchImpl, sendPushToAllUiSessions } = createRuntime();
    runtime.setAutoAcceptSession('ses_1', true);

    await runtime.maybeSendPushForTrigger(permissionAsked());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://opencode.test/permission/perm_1/reply?directory=%2Frepo');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({ reply: 'once' });
    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();
  });

  it('inherits auto-accept from a parent session before sending notifications', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url) === 'http://opencode.test/session') {
        return new Response(JSON.stringify([
          { id: 'parent_ses' },
          { id: 'child_ses', parentID: 'parent_ses' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, init }), { status: 200 });
    });
    const { runtime, sendPushToAllUiSessions } = createRuntime({ fetchImpl });
    runtime.setAutoAcceptSession('parent_ses', true);

    await runtime.maybeSendPushForTrigger(permissionAsked({
      id: 'perm_child',
      sessionID: 'child_ses',
      directory: '/repo',
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://opencode.test/session');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://opencode.test/permission/perm_child/reply?directory=%2Frepo');
    expect(sendPushToAllUiSessions).not.toHaveBeenCalled();
  });

  it('falls back to the notification path when server-side auto-accept fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));
    const { runtime, sendPushToAllUiSessions } = createRuntime({ fetchImpl });
    runtime.setAutoAcceptSession('ses_1', true);

    await runtime.maybeSendPushForTrigger(permissionAsked());
    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sendPushToAllUiSessions).toHaveBeenCalledTimes(1);
  });
});
