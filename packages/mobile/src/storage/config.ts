import * as SecureStore from 'expo-secure-store';
import type { StoredMobileConfig } from '../types';

const CONFIG_KEY = 'openchamber.mobile.config.v1';

export const loadMobileConfig = async (): Promise<StoredMobileConfig | null> => {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMobileConfig>;
    if (
      typeof parsed.serverUrl === 'string' &&
      typeof parsed.deviceId === 'string' &&
      typeof parsed.deviceToken === 'string'
    ) {
      return {
        serverUrl: parsed.serverUrl,
        deviceId: parsed.deviceId,
        deviceToken: parsed.deviceToken,
        lastWebUrl: typeof parsed.lastWebUrl === 'string' ? parsed.lastWebUrl : undefined,
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
