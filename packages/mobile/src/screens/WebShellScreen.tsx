import React from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { createMobileSession } from '../api/mobileClient';
import { getAppVersion, getDevicePlatform } from '../notifications/push';
import { createBridgeResponseScript, createInjectedBridge, handleBridgeMessage } from '../webview/bridge';
import type { StoredMobileConfig } from '../types';

interface WebShellScreenProps {
  config: StoredMobileConfig;
  pendingPath?: string | null;
  onReset(): void;
  onReady(webViewRef: React.RefObject<WebView | null>): void;
}

const shouldOpenExternal = (serverUrl: string, url: string): boolean => {
  try {
    const target = new URL(url);
    const server = new URL(serverUrl);
    return target.origin !== server.origin && (target.protocol === 'http:' || target.protocol === 'https:');
  } catch {
    return false;
  }
};

export const WebShellScreen: React.FC<WebShellScreenProps> = ({ config, pendingPath, onReset, onReady }) => {
  const webViewRef = React.useRef<WebView | null>(null);
  const [webUrl, setWebUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingSession(true);
    setError(null);
    void createMobileSession(config)
      .then((url) => {
        if (!cancelled) setWebUrl(url);
      })
      .catch((sessionError) => {
        if (!cancelled) setError(sessionError instanceof Error ? sessionError.message : 'Failed to create mobile session');
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  React.useEffect(() => {
    onReady(webViewRef);
  }, [onReady]);

  React.useEffect(() => {
    if (!pendingPath || !webViewRef.current) return;
    const script = `window.location.href = ${JSON.stringify(pendingPath)}; true;`;
    webViewRef.current.injectJavaScript(script);
  }, [pendingPath]);

  const injectedJavaScriptBeforeContentLoaded = React.useMemo(() => createInjectedBridge({
    platform: getDevicePlatform(),
    appVersion: getAppVersion(),
  }), []);

  const onMessage = React.useCallback((event: WebViewMessageEvent) => {
    void handleBridgeMessage(event).then((response) => {
      if (!response) return;
      webViewRef.current?.injectJavaScript(createBridgeResponseScript(response.id, response.ok, response.result, response.error));
    });
  }, []);

  const onShouldStartLoadWithRequest = React.useCallback((request: WebViewNavigation) => {
    if (shouldOpenExternal(config.serverUrl, request.url)) {
      void Linking.openURL(request.url);
      return false;
    }
    return true;
  }, [config.serverUrl]);

  if (loadingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.centerText}>Opening OpenChamber…</Text>
      </View>
    );
  }

  if (error || !webUrl) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Could not open OpenChamber</Text>
        <Text style={styles.errorText}>{error ?? 'Missing mobile session URL'}</Text>
        <Pressable style={styles.button} onPress={() => onReset()}>
          <Text style={styles.buttonText}>Reset pairing</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: webUrl }}
      style={styles.webview}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onHttpError={(event) => {
        if (event.nativeEvent.statusCode === 401) {
          Alert.alert('Session expired', 'OpenChamber mobile session expired. Reset pairing if this keeps happening.');
        }
      }}
    />
  );
};

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#111111',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#111111',
  },
  centerText: {
    color: '#dddddd',
    marginTop: 12,
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: '#b6b6b6',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    borderRadius: 12,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
