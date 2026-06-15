import type {
  ClientTokenMobileConfig,
  ConnectionPayload,
  DeviceMobileConfig,
  MobileSessionResponse,
  PairCompleteResponse,
  PairingPayload,
  PushRegistrationResponse,
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

const normalizeClientToken = (value: string): string => value.trim().replace(/^Bearer\s+/i, '').trim();

const emptyConnectionPayload = (): ConnectionPayload => ({
  serverUrl: null,
  clientToken: null,
  pairingToken: null,
  label: null,
});

const readStringField = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const parseConnectionUrl = (raw: string): ConnectionPayload | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const params = url.searchParams;
  const clientToken = normalizeClientToken(
    params.get('token') || params.get('clientToken') || params.get('client_token') || params.get('key') || '',
  );
  const pairingToken = params.get('pairingToken') || params.get('pairing_token') || '';
  const explicitServerUrl = params.get('server') || params.get('serverUrl') || params.get('url') || params.get('apiUrl') || '';
  const serverUrl = explicitServerUrl
    ? normalizeServerUrl(explicitServerUrl)
    : ((url.protocol === 'http:' || url.protocol === 'https:') && (clientToken || pairingToken)
      ? normalizeServerUrl(url.origin)
      : null);

  if (!serverUrl && !clientToken && !pairingToken) {
    return null;
  }

  return {
    serverUrl,
    clientToken: clientToken || null,
    pairingToken: pairingToken.trim() || null,
    label: params.get('label')?.trim() || null,
  };
};

const parseConnectionJson = (raw: string): ConnectionPayload | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const serverUrl = readStringField(record, ['serverUrl', 'server', 'url', 'apiUrl']);
  const clientToken = normalizeClientToken(readStringField(record, ['clientToken', 'client_token', 'token', 'key']));
  const pairingToken = readStringField(record, ['pairingToken', 'pairing_token']);

  return {
    serverUrl: serverUrl ? normalizeServerUrl(serverUrl) : null,
    clientToken: clientToken || null,
    pairingToken: pairingToken || null,
    label: readStringField(record, ['label', 'name']) || null,
  };
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
};

export const parseConnectionPayload = (raw: string): ConnectionPayload => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return emptyConnectionPayload();
  }

  return parseConnectionUrl(trimmed) || parseConnectionJson(trimmed) || emptyConnectionPayload();
};

export const parsePairingPayload = (raw: string): PairingPayload => {
  const parsed = parseConnectionPayload(raw);
  if (!parsed.pairingToken) {
    throw new Error('Pairing token is missing');
  }
  return {
    serverUrl: parsed.serverUrl,
    pairingToken: parsed.pairingToken,
  };
};

export const createClientTokenConfig = ({
  serverUrl,
  clientToken,
}: {
  serverUrl: string;
  clientToken: string;
}): ClientTokenMobileConfig => {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const normalizedClientToken = normalizeClientToken(clientToken);
  if (!normalizedServerUrl) {
    throw new Error('Server URL is required');
  }
  if (!normalizedClientToken) {
    throw new Error('Connection key is required');
  }
  return {
    authMode: 'clientToken',
    serverUrl: normalizedServerUrl,
    clientToken: normalizedClientToken,
  };
};

export const createDirectMobileWebUrl = (serverUrl: string): string => {
  return new URL('mobile.html', `${normalizeServerUrl(serverUrl)}/`).toString();
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
}): Promise<DeviceMobileConfig> => {
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
    authMode: 'device',
    serverUrl: normalizedServerUrl,
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
  };
};

export const createMobileSession = async (config: DeviceMobileConfig): Promise<string> => {
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
  config: DeviceMobileConfig;
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
