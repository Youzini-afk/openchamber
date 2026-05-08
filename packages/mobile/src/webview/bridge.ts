import type { WebViewMessageEvent } from 'react-native-webview';
import { Linking, Share } from 'react-native';
import * as Notifications from 'expo-notifications';

interface BridgeRequest {
  id?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

export const createInjectedBridge = ({ platform, appVersion }: { platform: string; appVersion: string }): string => `
(function () {
  if (window.__OPENCHAMBER_MOBILE_APP__) return true;
  window.__OPENCHAMBER_MOBILE_APP__ = {
    platform: ${JSON.stringify(platform)},
    appVersion: ${JSON.stringify(appVersion)},
    bridgeVersion: 1
  };
  var pending = {};
  window.openchamberMobile = {
    platform: ${JSON.stringify(platform)},
    appVersion: ${JSON.stringify(appVersion)},
    bridgeVersion: 1,
    request: function (type, payload) {
      var id = 'mob_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, type: type, payload: payload || {} }));
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error('Mobile bridge request timed out'));
        }, 30000);
      });
    },
    openExternal: function (url) { return this.request('openExternal', { url: url }); },
    share: function (payload) { return this.request('share', payload || {}); },
    setBadge: function (count) { return this.request('setBadge', { count: count }); }
  };
  window.__OPENCHAMBER_MOBILE_BRIDGE_RESOLVE__ = function (message) {
    var entry = pending[message.id];
    if (!entry) return;
    delete pending[message.id];
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || 'Mobile bridge request failed'));
  };
  document.documentElement.classList.add('runtime-mobile-app');
  true;
})();
`;

export const createBridgeResponseScript = (id: string, ok: boolean, result?: unknown, error?: string): string => `
(function () {
  if (window.__OPENCHAMBER_MOBILE_BRIDGE_RESOLVE__) {
    window.__OPENCHAMBER_MOBILE_BRIDGE_RESOLVE__(${JSON.stringify({ id, ok, result, error })});
  }
  true;
})();
`;

export const handleBridgeMessage = async (event: WebViewMessageEvent): Promise<{ id: string; ok: boolean; result?: unknown; error?: string } | null> => {
  let request: BridgeRequest;
  try {
    request = JSON.parse(event.nativeEvent.data) as BridgeRequest;
  } catch {
    return null;
  }
  if (!request.id || !request.type) {
    return null;
  }

  try {
    if (request.type === 'openExternal') {
      const url = request.payload?.url;
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('url required');
      }
      await Linking.openURL(url);
      return { id: request.id, ok: true, result: {} };
    }

    if (request.type === 'share') {
      await Share.share({
        title: typeof request.payload?.title === 'string' ? request.payload.title : undefined,
        message: [request.payload?.text, request.payload?.url]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n'),
      });
      return { id: request.id, ok: true, result: {} };
    }

    if (request.type === 'setBadge') {
      const count = typeof request.payload?.count === 'number' && Number.isFinite(request.payload.count)
        ? Math.max(0, Math.floor(request.payload.count))
        : 0;
      await Notifications.setBadgeCountAsync(count);
      return { id: request.id, ok: true, result: { count } };
    }

    return { id: request.id, ok: false, error: `Unsupported bridge request: ${request.type}` };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : 'Bridge request failed' };
  }
};
