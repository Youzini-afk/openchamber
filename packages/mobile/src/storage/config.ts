import * as SecureStore from 'expo-secure-store';
import type { StoredMobileConfig } from '../types';

const CONFIG_KEY = 'openchamber.mobile.config.v1';

export const loadMobileConfig = async (): Promise<StoredMobileConfig | null> => {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMobileConfig>;
    const serverUrl = typeof parsed.serverUrl === 'string' ? parsed.serverUrl.trim() : '';
    const lastWebUrl = typeof parsed.lastWebUrl === 'string' ? parsed.lastWebUrl : undefined;
    if (!serverUrl) {
      return null;
    }
    if (typeof parsed.clientToken === 'string' && parsed.clientToken.trim()) {
      return {
        authMode: 'clientToken',
        serverUrl,
        clientToken: parsed.clientToken.trim(),
        lastWebUrl,
      };
    }
    if (typeof parsed.deviceId === 'string' && typeof parsed.deviceToken === 'string') {
      return {
        authMode: 'device',
        serverUrl,
        deviceId: parsed.deviceId,
        deviceToken: parsed.deviceToken,
        lastWebUrl,
      };
    }
  } catch {
    // Ignore corrupt storage and let the user pair again.
  }
  return null;
};

export const saveMobileConfig = async (config: StoredMobileConfig): Promise<void> => {
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config));
};

export const clearMobileConfig = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(CONFIG_KEY);
};
