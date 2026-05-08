export type MobilePlatform = 'ios' | 'android' | 'unknown';

export interface StoredMobileConfig {
  serverUrl: string;
  deviceId: string;
  deviceToken: string;
  lastWebUrl?: string;
}

export interface PairingPayload {
  serverUrl: string | null;
  pairingToken: string;
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
