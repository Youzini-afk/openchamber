import { createConfiguredWebAPIs } from './runtimeConfig';
import { registerSW } from 'virtual:pwa-register';

import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import { getStoredMobileLayoutPreference } from '@openchamber/ui/lib/mobileLayoutPreference';
import type { HostedSurface } from '@openchamber/ui/lib/runtimeSurface';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';

import { detectHostedSurface } from './hostedSurface';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
    __OPENCHAMBER_SURFACE__?: HostedSurface;
  }
}

window.__OPENCHAMBER_RUNTIME_APIS__ = createConfiguredWebAPIs();

const isCoarsePointer = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(pointer: coarse)').matches;
};

const hostedSurface = detectHostedSurface({
  search: window.location.search,
  innerWidth: window.innerWidth || 0,
  screenWidth: window.screen?.width || window.innerWidth || 0,
  maxTouchPoints: navigator.maxTouchPoints || 0,
  isCoarsePointer: isCoarsePointer(),
  mobileLayoutPreference: getStoredMobileLayoutPreference(),
});
window.__OPENCHAMBER_SURFACE__ = hostedSurface;

type PrerenderingDocument = Document & {
  prerendering?: boolean;
};

const canUseServiceWorker = (): boolean => {
  if (!('serviceWorker' in navigator)) return false;
  if (!window.isSecureContext) return false;
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return false;

  const documentState = document as PrerenderingDocument;
  if (documentState.prerendering || String(document.visibilityState) === 'prerender') {
    return false;
  }

  return true;
};

const runWhenDocumentCanRegisterServiceWorker = (task: () => void): void => {
  let completed = false;
  const run = () => {
    if (completed) return;
    if (canUseServiceWorker()) {
      completed = true;
      task();
    }
  };

  const afterLoad = () => {
    setTimeout(run, 0);
  };

  if (document.readyState === 'complete') {
    afterLoad();
  } else {
    window.addEventListener('load', afterLoad, { once: true });
  }

  const documentState = document as PrerenderingDocument;
  if (documentState.prerendering || String(document.visibilityState) === 'prerender') {
    document.addEventListener('visibilitychange', run, { once: true });
  }
};

const registerPwaServiceWorker = (): void => {
  runWhenDocumentCanRegisterServiceWorker(() => {
    try {
      registerSW({
        onRegisterError(error: unknown) {
          console.warn('[PWA] service worker registration skipped:', error);
        },
      });
    } catch (error) {
      console.warn('[PWA] service worker registration skipped:', error);
    }
  });
};

const unregisterDevelopmentServiceWorkers = (): void => {
  runWhenDocumentCanRegisterServiceWorker(() => {
    void navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});
  });
};

if (hostedSurface === 'mobile') {
  void import('@openchamber/ui/apps/renderMobileApp')
    .then(({ renderMobileApp }) => {
      renderMobileApp(window.__OPENCHAMBER_RUNTIME_APIS__ ?? createConfiguredWebAPIs());
    });
} else {
  void import('@openchamber/ui/main');
}

if (import.meta.env.PROD) {
  registerPwaServiceWorker();
} else {
  unregisterDevelopmentServiceWorkers();
}
