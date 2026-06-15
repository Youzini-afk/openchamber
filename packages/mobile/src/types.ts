export type MobilePlatform = 'ios' | 'android' | 'unknown';

interface BaseMobileConfig {
  serverUrl: string;
  lastWebUrl?: string;
}

export interface DeviceMobileConfig extends BaseMobileConfig {
  authMode?: 'device';
  deviceId: string;
  deviceToken: string;
  clientToken?: never;
}

export interface ClientTokenMobileConfig extends BaseMobileConfig {
  authMode: 'clientToken';
  clientToken: string;
  deviceId?: never;
  deviceToken?: never;
}

export type StoredMobileConfig = DeviceMobileConfig | ClientTokenMobileConfig;

export interface PairingPayload {
  serverUrl: string | null;
  pairingToken: string;
}

export interface ConnectionPayload {
  serverUrl: string | null;
  clientToken: string | null;
  pairingToken: string | null;
  label?: string | null;
}

export interface PairCompleteResponse {
  deviceId: string;
  deviceToken: string;
  device: {
    id: string;
    name: string;
    platform: MobilePlatform;
    pushEnabled: boolean;
  };
}

export interface MobileSessionResponse {
  loginUrl: string;
  expiresAt: number;
}

export interface PushRegistrationResponse {
  ok: true;
  device: {
    id: string;
    name: string;
    platform: MobilePlatform;
    pushEnabled: boolean;
  };
}

export type AppState =
  | { status: 'loading' }
  | { status: 'pairing'; initialServerUrl?: string }
  | { status: 'web'; config: StoredMobileConfig };

export const isDeviceMobileConfig = (config: StoredMobileConfig): config is DeviceMobileConfig => {
  return typeof config.deviceId === 'string' && typeof config.deviceToken === 'string';
};

export const isClientTokenMobileConfig = (config: StoredMobileConfig): config is ClientTokenMobileConfig => {
  return config.authMode === 'clientToken' && typeof config.clientToken === 'string';
};
