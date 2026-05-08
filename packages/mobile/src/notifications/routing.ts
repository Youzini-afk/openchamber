import * as Linking from 'expo-linking';
import type React from 'react';
import type { WebView } from 'react-native-webview';

export const getUrlFromNotificationData = (data: Record<string, unknown> | undefined): string | null => {
  const url = data?.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
};

export const routeWebViewToPath = (webViewRef: React.RefObject<WebView | null>, pathOrUrl: string): void => {
  const script = `
    (function () {
      var target = ${JSON.stringify(pathOrUrl)};
      if (target) window.location.href = target;
    })();
    true;
  `;
  webViewRef.current?.injectJavaScript(script);
};

export const parseOpenChamberLink = (url: string): string | null => {
  const parsed = Linking.parse(url);
  if (parsed.scheme !== 'openchamber') {
    return null;
  }
  if (parsed.hostname === 'session' && typeof parsed.path === 'string' && parsed.path.length > 0) {
    return `/?session=${encodeURIComponent(parsed.path)}`;
  }
  const sessionId = parsed.queryParams?.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return `/?session=${encodeURIComponent(sessionId)}`;
  }
  return '/';
};
