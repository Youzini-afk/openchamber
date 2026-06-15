import React from 'react';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { completePairing, normalizeServerUrl, parsePairingPayload } from '../api/mobileClient';
import { t } from '../i18n';
import { getAppVersion, getDeviceName, getDevicePlatform } from '../notifications/push';
import type { StoredMobileConfig } from '../types';

interface PairingScreenProps {
  initialServerUrl?: string;
  onPaired(config: StoredMobileConfig): void;
}

export const PairingScreen: React.FC<PairingScreenProps> = ({ initialServerUrl, onPaired }) => {
  const { width } = useWindowDimensions();
  const [serverUrl, setServerUrl] = React.useState(initialServerUrl ?? '');
  const [payloadText, setPayloadText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scanned, setScanned] = React.useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const pair = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = parsePairingPayload(payloadText);
      const resolvedServerUrl = normalizeServerUrl(payload.serverUrl || serverUrl);
      if (!resolvedServerUrl) {
        throw new Error(t('pairing.error.serverUrlRequired'));
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
      setError(pairError instanceof Error ? pairError.message : t('pairing.error.failed'));
    } finally {
      setBusy(false);
    }
  }, [onPaired, payloadText, serverUrl]);

  const openScanner = React.useCallback(async () => {
    setError(null);
    if (!permission?.granted) {
      const nextPermission = await requestPermission();
      if (!nextPermission.granted) {
        setError(t('pairing.error.cameraPermissionRequired'));
        return;
      }
    }
    setScanned(false);
    setScannerOpen(true);
  }, [permission?.granted, requestPermission]);

  const handleBarcodeScanned = React.useCallback((result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);
    setScannerOpen(false);
    setPayloadText(result.data);
    try {
      const payload = parsePairingPayload(result.data);
      if (payload.serverUrl) {
        setServerUrl(payload.serverUrl);
      }
    } catch {
      // Keep scanned text visible so the user can inspect or edit it.
    }
  }, [scanned]);

  if (scannerOpen) {
    return (
      <View style={styles.scannerContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        />
        <View
          style={[
            styles.scannerOverlay,
            width >= 700 && {
              left: Math.max(24, (width - 520) / 2),
              right: Math.max(24, (width - 520) / 2),
            },
          ]}
        >
          <Text style={styles.scannerTitle}>{t('pairing.scanner.title')}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => setScannerOpen(false)}>
            <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.panel, width >= 700 && styles.panelWide]}>
        <Text style={styles.title}>{t('pairing.title')}</Text>
        <Text style={styles.subtitle}>{t('pairing.subtitle')}</Text>

        <Pressable disabled={busy} onPress={() => void openScanner()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t('pairing.action.scanQrCode')}</Text>
        </Pressable>

        <Text style={styles.label}>{t('pairing.label.serverUrl')}</Text>
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

        <Text style={styles.label}>{t('pairing.label.payload')}</Text>
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
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('pairing.action.pairDevice')}</Text>}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#111111',
  },
  panel: {
    width: '100%',
  },
  panelWide: {
    maxWidth: 520,
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
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    marginBottom: 16,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 40,
    borderRadius: 16,
    backgroundColor: 'rgba(17,17,17,0.86)',
    padding: 16,
  },
  scannerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
});
