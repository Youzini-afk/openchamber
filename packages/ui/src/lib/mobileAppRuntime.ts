import React from 'react';

export const isMobileAppRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __OPENCHAMBER_MOBILE_APP__?: unknown }).__OPENCHAMBER_MOBILE_APP__);
};

export const useMobileAppViewport = (enabled: boolean): void => {
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const root = document.documentElement;
    root.classList.add('runtime-mobile-app');

    const updateViewportVars = () => {
      const viewport = window.visualViewport;
      const keyboardHeight = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      root.style.setProperty('--oc-mobile-keyboard-height', `${Math.round(keyboardHeight)}px`);
      root.style.setProperty('--oc-mobile-viewport-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      root.style.setProperty('--oc-safe-area-top', 'env(safe-area-inset-top, 0px)');
      root.style.setProperty('--oc-safe-area-right', 'env(safe-area-inset-right, 0px)');
      root.style.setProperty('--oc-safe-area-bottom', 'env(safe-area-inset-bottom, 0px)');
      root.style.setProperty('--oc-safe-area-left', 'env(safe-area-inset-left, 0px)');
    };

    updateViewportVars();
    window.visualViewport?.addEventListener('resize', updateViewportVars);
    window.visualViewport?.addEventListener('scroll', updateViewportVars);
    window.addEventListener('resize', updateViewportVars);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportVars);
      window.visualViewport?.removeEventListener('scroll', updateViewportVars);
      window.removeEventListener('resize', updateViewportVars);
      root.style.removeProperty('--oc-mobile-keyboard-height');
      root.style.removeProperty('--oc-mobile-viewport-height');
    };
  }, [enabled]);
};
