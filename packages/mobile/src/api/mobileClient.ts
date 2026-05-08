import type {
  MobileSessionResponse,
  PairCompleteResponse,
  PairingPayload,
  PushRegistrationResponse,
  StoredMobileConfig,
} from '../types';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const normalizeServerUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimTrailingSlash(trimmed);
  }
  return trimTrailingSlash(`https://${trimmed}`);
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
};

export const parsePairingPayload = (raw: string): PairingPayload => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Pairing payload is empty');
  }
  const parsed = JSON.parse(trimmed) as Partial<PairingPayload>;
  if (typeof parsed.pairingToken !== 'string' || parsed.pairingToken.trim().length === 0) {
    throw new Error('Pairing token is missing');
  }
  return {
    serverUrl: typeof parsed.serverUrl === 'string' ? normalizeServerUrl(parsed.serverUrl) : null,
    pairingToken: parsed.pairingToken.trim(),
  };
};

export const completePairing = async ({
  serverUrl,
  pairingToken,
  deviceName,
  platform,
  appVersion,
}: {
  serverUrl: string;
  pairingToken: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}): Promise<StoredMobileConfig> => {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${normalizedServerUrl}/api/mobile/pair/complete`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pairingToken, deviceName, platform, appVersion }),
  });
  const result = await parseJsonResponse<PairCompleteResponse>(response);
  return {
    serverUrl: normalizedServerUrl,
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
  };
};

export const createMobileSession = async (config: StoredMobileConfig): Promise<string> => {
  const response = await fetch(`${config.serverUrl}/api/mobile/session`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deviceToken}`,
      'x-openchamber-device-id': config.deviceId,
    },
    body: JSON.stringify({ deviceId: config.deviceId }),
  });
  const result = await parseJsonResponse<MobileSessionResponse>(response);
  if (!result.loginUrl) {
    throw new Error('Mobile session response did not include loginUrl');
  }
  return new URL(result.loginUrl, config.serverUrl).toString();
};

export const registerPushToken = async ({
  config,
  pushToken,
  appVersion,
}: {
  config: StoredMobileConfig;
  pushToken: string;
  appVersion: string;
}): Promise<PushRegistrationResponse> => {
  const response = await fetch(`${config.serverUrl}/api/mobile/devices/register-push`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deviceToken}`,
      'x-openchamber-device-id': config.deviceId,
    },
    body: JSON.stringify({
      deviceId: config.deviceId,
      pushProvider: 'expo',
      pushToken,
      appVersion,
    }),
  });
  return parseJsonResponse<PushRegistrationResponse>(response);
};
