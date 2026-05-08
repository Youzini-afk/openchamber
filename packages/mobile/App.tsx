import React from 'react';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import type { WebView } from 'react-native-webview';
import { PairingScreen } from './src/screens/PairingScreen';
import { WebShellScreen } from './src/screens/WebShellScreen';
import { ensurePushRegistered } from './src/notifications/push';
import { getUrlFromNotificationData, parseOpenChamberLink, routeWebViewToPath } from './src/notifications/routing';
import { clearMobileConfig, loadMobileConfig, saveMobileConfig } from './src/storage/config';
import type { AppState, StoredMobileConfig } from './src/types';

export default function App() {
  const [appState, setAppState] = React.useState<AppState>({ status: 'loading' });
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);
  const webViewRef = React.useRef<WebView | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadMobileConfig().then((config) => {
      if (cancelled) return;
      setAppState(config ? { status: 'web', config } : { status: 'pairing' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUrl = React.useCallback((url: string | null) => {
    if (!url) return;
    const path = parseOpenChamberLink(url);
    if (!path) return;
    setPendingPath(path);
    if (webViewRef.current) {
      routeWebViewToPath(webViewRef, path);
    }
  }, []);

  React.useEffect(() => {
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, [handleUrl]);

  React.useEffect(() => {
    const lastResponse = Notifications.getLastNotificationResponse();
    handleUrl(getUrlFromNotificationData(lastResponse?.notification.request.content.data));
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleUrl(getUrlFromNotificationData(response.notification.request.content.data));
    });
    return () => subscription.remove();
  }, [handleUrl]);

  React.useEffect(() => {
    if (appState.status !== 'web') return;
    void ensurePushRegistered(appState.config).catch((error) => {
      console.warn('Failed to register push token:', error);
    });
  }, [appState]);

  const handlePaired = React.useCallback((config: StoredMobileConfig) => {
    void saveMobileConfig(config).then(() => setAppState({ status: 'web', config }));
  }, []);

  const handleReset = React.useCallback(() => {
    void clearMobileConfig().then(() => setAppState({ status: 'pairing' }));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {appState.status === 'web' ? (
        <WebShellScreen
          config={appState.config}
          pendingPath={pendingPath}
          onReset={handleReset}
          onReady={(ref) => {
            webViewRef.current = ref.current;
          }}
        />
      ) : (
        <PairingScreen
          initialServerUrl={appState.status === 'pairing' ? appState.initialServerUrl : undefined}
          onPaired={handlePaired}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
});
