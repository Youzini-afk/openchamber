import { describe, expect, it } from 'vitest';

import { createGlobalMessageStreamHub } from './global-hub.js';

function createHeldSseResponse(signal) {
  let releaseAbort;
  const abortReleased = new Promise((resolve) => {
    releaseAbort = resolve;
  });

  const response = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (signal.aborted) {
              await abortReleased;
              const error = new Error('Aborted');
              error.name = 'AbortError';
              throw error;
            }

            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', async () => {
                await abortReleased;
                const error = new Error('Aborted');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          },
        };
      },
    },
  };

  return { response, releaseAbort };
}

function createOpenSseResponse(signal) {
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                const error = new Error('Aborted');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          },
        };
      },
    },
  };
}

describe('createGlobalMessageStreamHub', () => {
  it('ignores stale disconnect callbacks after the hub is restarted', async () => {
    const statuses = [];
    let firstReleaseAbort = null;
    let fetchCalls = 0;

    const hub = createGlobalMessageStreamHub({
      buildOpenCodeUrl: (path) => `http://127.0.0.1:4096${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 0,
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          const held = createHeldSseResponse(options.signal);
          firstReleaseAbort = held.releaseAbort;
          return held.response;
        }
        return createOpenSseResponse(options.signal);
      },
    });

    hub.subscribeStatus((status) => {
      statuses.push(status.type);
    });

    hub.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hub.isConnected()).toBe(true);

    hub.stop();
    hub.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hub.isConnected()).toBe(true);

    firstReleaseAbort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hub.isConnected()).toBe(true);
    expect(statuses).toEqual(['connect', 'connect']);

    hub.stop();
  });
});
