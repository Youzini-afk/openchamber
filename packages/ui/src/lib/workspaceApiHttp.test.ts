import { describe, expect, test } from 'bun:test';

import { createWorkspaceHttpAPI } from './workspaceApiHttp';

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const setGlobal = (key: keyof typeof globalThis, value: unknown) => {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
};

const restoreGlobal = (key: keyof typeof globalThis, value: unknown) => {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, key);
    return;
  }
  setGlobal(key, value);
};

const setUrlMethod = (key: 'createObjectURL' | 'revokeObjectURL', value: unknown) => {
  Object.defineProperty(URL, key, {
    configurable: true,
    writable: true,
    value,
  });
};

type FetchCall = {
  input: string | URL | Request;
  init?: RequestInit;
};

type DownloadEnvironment = {
  fetchCalls: FetchCall[];
  appended: unknown[];
  removed: unknown[];
  revoked: string[];
  link: HTMLAnchorElement;
  clickCount: number;
};

const restoreEnvironment = () => {
  restoreGlobal('fetch', originalFetch);
  restoreGlobal('document', originalDocument);
  restoreGlobal('window', originalWindow);
  setUrlMethod('createObjectURL', originalCreateObjectURL);
  setUrlMethod('revokeObjectURL', originalRevokeObjectURL);
};

const withDownloadEnvironment = async (
  responseFactory: () => Response | Promise<Response>,
  run: (environment: DownloadEnvironment) => Promise<void>,
) => {
  const environment: DownloadEnvironment = {
    fetchCalls: [],
    appended: [],
    removed: [],
    revoked: [],
    link: {
      href: '',
      download: '',
      click: () => {
        environment.clickCount += 1;
      },
    } as unknown as HTMLAnchorElement,
    clickCount: 0,
  };

  setGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) => {
    environment.fetchCalls.push({ input, init });
    return responseFactory();
  }) as typeof fetch);
  setGlobal('document', {
    createElement: (tagName: string) => {
      expect(tagName).toBe('a');
      return environment.link;
    },
    body: {
      appendChild: (node: Node) => {
        environment.appended.push(node);
        return node;
      },
      removeChild: (node: Node) => {
        environment.removed.push(node);
        return node;
      },
    },
  } as unknown as Document);
  setGlobal('window', {
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
  } as unknown as Window);
  setUrlMethod('createObjectURL', () => 'blob:workspace-download');
  setUrlMethod('revokeObjectURL', (url: string) => {
    environment.revoked.push(url);
  });

  try {
    await run(environment);
  } finally {
    restoreEnvironment();
  }
};

describe('workspaceApiHttp download', () => {
  test('saves successful downloads using the response filename', async () => {
    await withDownloadEnvironment(
      () => new Response(new Blob(['zip-bytes']), {
        status: 200,
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''OpenLocus.zip",
          'Content-Type': 'application/zip',
        },
      }),
      async (environment) => {
        await createWorkspaceHttpAPI().download('projects/OpenLocus');

        expect(environment.fetchCalls.length).toBe(1);
        expect(environment.fetchCalls[0]?.input).toBe('/api/workspace/download?path=projects%2FOpenLocus');
        expect(environment.link.href).toBe('blob:workspace-download');
        expect(environment.link.download).toBe('OpenLocus.zip');
        expect(environment.appended).toEqual([environment.link]);
        expect(environment.clickCount).toBe(1);
        expect(environment.removed).toEqual([environment.link]);
        expect(environment.revoked).toEqual(['blob:workspace-download']);
      },
    );
  });

  test('throws JSON errors instead of saving them as downloaded files', async () => {
    await withDownloadEnvironment(
      () => new Response(JSON.stringify({ error: 'Directory is too large to download' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }),
      async (environment) => {
        let thrown: unknown = null;
        try {
          await createWorkspaceHttpAPI().download('OpenLocus');
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe('Directory is too large to download');
        expect(environment.appended).toEqual([]);
        expect(environment.clickCount).toBe(0);
      },
    );
  });
});

