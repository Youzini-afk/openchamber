import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { completePairing, normalizeServerUrl, parsePairingPayload } from '../api/mobileClient';
import { getAppVersion, getDeviceName, getDevicePlatform } from '../notifications/push';
import type { StoredMobileConfig } from '../types';

interface PairingScreenProps {
  initialServerUrl?: string;
  onPaired(config: StoredMobileConfig): void;
}

export const PairingScreen: React.FC<PairingScreenProps> = ({ initialServerUrl, onPaired }) => {
  const [serverUrl, setServerUrl] = React.useState(initialServerUrl ?? '');
  const [payloadText, setPayloadText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pair = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = parsePairingPayload(payloadText);
      const resolvedServerUrl = normalizeServerUrl(payload.serverUrl || serverUrl);
      if (!resolvedServerUrl) {
        throw new Error('Server URL is required');
      }
      const config = await completePairing({
        serverUrl: resolvedServerUrl,
        pairingToken: payload.pairingToken,
        deviceName: getDeviceName(),
        platform: getDevicePlatform(),
        appVersion: getAppVersion(),
      });
      onPaired(config);
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : 'Pairing failed');
    } finally {
      setBusy(false);
    }
  }, [onPaired, payloadText, serverUrl]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OpenChamber Mobile</Text>
      <Text style={styles.subtitle}>Paste the pairing payload from Settings → Notifications → Mobile App.</Text>

      <Text style={styles.label}>Server URL</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={serverUrl}
        onChangeText={setServerUrl}
        placeholder="https://openchamber.example.com"
        placeholderTextColor="#777"
        style={styles.input}
      />

      <Text style={styles.label}>Pairing payload</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        value={payloadText}
        onChangeText={setPayloadText}
        placeholder='{"serverUrl":"https://...","pairingToken":"pair_..."}'
        placeholderTextColor="#777"
        style={[styles.input, styles.payloadInput]}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable disabled={busy} onPress={() => void pair()} style={[styles.button, busy && styles.buttonDisabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair device</Text>}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#111111',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#b6b6b6',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
  },
  label: {
    color: '#dddddd',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    color: '#ffffff',
    backgroundColor: '#1d1d1d',
    borderColor: '#333333',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  payloadInput: {
    minHeight: 112,
    textAlignVertical: 'top',
  },
  error: {
    color: '#ff6b6b',
    marginBottom: 14,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#4f46e5',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
