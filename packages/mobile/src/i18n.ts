import { getLocales } from 'expo-localization';

type Locale = 'en' | 'zh-Hans';

type TranslationKey =
  | 'pairing.error.serverUrlRequired'
  | 'pairing.error.connectionKeyRequired'
  | 'pairing.error.failed'
  | 'pairing.error.cameraPermissionRequired'
  | 'pairing.scanner.title'
  | 'common.cancel'
  | 'pairing.title'
  | 'pairing.subtitle'
  | 'pairing.action.scanQrCode'
  | 'pairing.label.serverUrl'
  | 'pairing.label.connectionKey'
  | 'pairing.action.connect'
  | 'web.error.createSessionFailed'
  | 'web.loading.opening'
  | 'web.error.couldNotOpen'
  | 'web.error.missingSessionUrl'
  | 'web.action.resetPairing'
  | 'web.alert.sessionExpired.title'
  | 'web.alert.sessionExpired.message';

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en: {
    'pairing.error.serverUrlRequired': 'Server URL is required',
    'pairing.error.connectionKeyRequired': 'Connection key is required',
    'pairing.error.failed': 'Connection failed',
    'pairing.error.cameraPermissionRequired': 'Camera permission is required to scan connection codes.',
    'pairing.scanner.title': 'Scan OpenChamber connection code',
    'common.cancel': 'Cancel',
    'pairing.title': 'OpenChamber Mobile',
    'pairing.subtitle': 'Enter the instance URL and connection key, or scan a connection code from another OpenChamber client.',
    'pairing.action.scanQrCode': 'Scan connection code',
    'pairing.label.serverUrl': 'Server URL',
    'pairing.label.connectionKey': 'Connection key',
    'pairing.action.connect': 'Connect',
    'web.error.createSessionFailed': 'Failed to create mobile session',
    'web.loading.opening': 'Opening OpenChamber…',
    'web.error.couldNotOpen': 'Could not open OpenChamber',
    'web.error.missingSessionUrl': 'Missing mobile session URL',
    'web.action.resetPairing': 'Reset pairing',
    'web.alert.sessionExpired.title': 'Session expired',
    'web.alert.sessionExpired.message': 'OpenChamber mobile session expired. Reset pairing if this keeps happening.',
  },
  'zh-Hans': {
    'pairing.error.serverUrlRequired': '必须填写服务器 URL',
    'pairing.error.connectionKeyRequired': '必须填写连接 key',
    'pairing.error.failed': '连接失败',
    'pairing.error.cameraPermissionRequired': '需要相机权限才能扫描连接码。',
    'pairing.scanner.title': '扫描 OpenChamber 连接码',
    'common.cancel': '取消',
    'pairing.title': 'OpenChamber 移动端',
    'pairing.subtitle': '输入实例 URL 和连接 key，也可以扫描其他 OpenChamber 客户端提供的连接码。',
    'pairing.action.scanQrCode': '扫描连接码',
    'pairing.label.serverUrl': '服务器 URL',
    'pairing.label.connectionKey': '连接 key',
    'pairing.action.connect': '连接',
    'web.error.createSessionFailed': '创建移动会话失败',
    'web.loading.opening': '正在打开 OpenChamber…',
    'web.error.couldNotOpen': '无法打开 OpenChamber',
    'web.error.missingSessionUrl': '缺少移动会话 URL',
    'web.action.resetPairing': '重置配对',
    'web.alert.sessionExpired.title': '会话已过期',
    'web.alert.sessionExpired.message': 'OpenChamber 移动会话已过期。如果持续发生，请重置配对。',
  },
};

const getDeviceLocale = (): string | undefined => {
  try {
    const locales = getLocales();
    const primary = locales.find((locale) => locale.languageTag || locale.languageCode);
    return primary?.languageTag ?? primary?.languageCode ?? undefined;
  } catch {
    return undefined;
  }
};

const getLocale = (): Locale => {
  const locale = getDeviceLocale()?.replace('_', '-').toLowerCase();
  return locale?.startsWith('zh') ? 'zh-Hans' : 'en';
};

export const t = (key: TranslationKey): string => translations[getLocale()][key] ?? translations.en[key];
