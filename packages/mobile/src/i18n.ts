import { NativeModules, Platform } from 'react-native';

type Locale = 'en' | 'zh-Hans';

type TranslationKey =
  | 'pairing.error.serverUrlRequired'
  | 'pairing.error.failed'
  | 'pairing.error.cameraPermissionRequired'
  | 'pairing.scanner.title'
  | 'common.cancel'
  | 'pairing.title'
  | 'pairing.subtitle'
  | 'pairing.action.scanQrCode'
  | 'pairing.label.serverUrl'
  | 'pairing.label.payload'
  | 'pairing.action.pairDevice'
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
    'pairing.error.failed': 'Pairing failed',
    'pairing.error.cameraPermissionRequired': 'Camera permission is required to scan pairing QR codes.',
    'pairing.scanner.title': 'Scan OpenChamber pairing code',
    'common.cancel': 'Cancel',
    'pairing.title': 'OpenChamber Mobile',
    'pairing.subtitle': 'Paste the pairing payload from Settings → Notifications → Mobile App.',
    'pairing.action.scanQrCode': 'Scan QR code',
    'pairing.label.serverUrl': 'Server URL',
    'pairing.label.payload': 'Pairing payload',
    'pairing.action.pairDevice': 'Pair device',
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
    'pairing.error.failed': '配对失败',
    'pairing.error.cameraPermissionRequired': '需要相机权限才能扫描配对二维码。',
    'pairing.scanner.title': '扫描 OpenChamber 配对码',
    'common.cancel': '取消',
    'pairing.title': 'OpenChamber 移动端',
    'pairing.subtitle': '粘贴来自“设置 → 通知 → 移动应用”的配对内容。',
    'pairing.action.scanQrCode': '扫描二维码',
    'pairing.label.serverUrl': '服务器 URL',
    'pairing.label.payload': '配对内容',
    'pairing.action.pairDevice': '配对设备',
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
  if (Platform.OS === 'ios') {
    const settings = NativeModules.SettingsManager?.settings;
    return settings?.AppleLocale ?? settings?.AppleLanguages?.[0];
  }

  return NativeModules.I18nManager?.localeIdentifier;
};

const getLocale = (): Locale => {
  const locale = getDeviceLocale()?.replace('_', '-').toLowerCase();
  return locale?.startsWith('zh') ? 'zh-Hans' : 'en';
};

export const t = (key: TranslationKey): string => translations[getLocale()][key] ?? translations.en[key];
