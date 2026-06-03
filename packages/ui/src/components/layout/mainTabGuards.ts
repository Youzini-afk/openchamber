import type { MainTab } from '@/stores/useUIStore';

const DESKTOP_HEADER_HIDDEN_MAIN_TABS = new Set<MainTab>([
  'git',
  'terminal',
  'diff',
  'context',
]);

export const shouldResetDesktopMainTabToChat = (tab: MainTab, isMobile: boolean): boolean => (
  !isMobile && DESKTOP_HEADER_HIDDEN_MAIN_TABS.has(tab)
);
