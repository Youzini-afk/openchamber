import React from 'react';
import { AgentManagerView } from '@/components/views/agent-manager';
import { FireworksProvider } from '@/contexts/FireworksContext';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { VSCodeLayout } from '@/components/layout/VSCodeLayout';
import { usePushVisibilityBeacon } from '@/hooks/usePushVisibilityBeacon';
import { useRouter } from '@/hooks/useRouter';
import { useWindowTitle } from '@/hooks/useWindowTitle';
import { opencodeClient } from '@/lib/opencode/client';
import type { RuntimeAPIs } from '@/lib/api/types';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { SyncProvider } from '@/sync/sync-context';
import { SyncAppEffects } from './AppEffects';
import { useAppFontEffects } from './useAppFontEffects';

const SettingsView = lazyWithChunkRecovery(() => import('@/components/views/SettingsView').then(m => ({ default: m.SettingsView })));

type VSCodePanelType = 'chat' | 'agentManager' | 'settings';

declare global {
  interface Window {
    __OPENCHAMBER_PANEL_TYPE__?: VSCodePanelType;
  }
}

type VSCodeAppProps = {
  apis: RuntimeAPIs;
};

export function VSCodeApp({ apis }: VSCodeAppProps) {
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const error = useSessionUIStore((state) => state.error);
  const clearError = useSessionUIStore((state) => state.clearError);
  const wideChatLayoutEnabled = useUIStore((state) => state.wideChatLayoutEnabled);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const refreshGitHubAuthStatus = useGitHubAuthStore((state) => state.refreshStatus);
  const setPlanModeEnabled = useFeatureFlagsStore((state) => state.setPlanModeEnabled);
  const panelType = typeof window !== 'undefined'
    ? window.__OPENCHAMBER_PANEL_TYPE__
    : 'chat';
  const vscodeWorkspaceFolder = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    const configured = (window as unknown as { __VSCODE_CONFIG__?: { workspaceFolder?: unknown } })
      .__VSCODE_CONFIG__?.workspaceFolder;
    return typeof configured === 'string' ? configured : '';
  }, []);
  const syncDirectory = currentDirectory || vscodeWorkspaceFolder || '';
  const initialSettingsPage = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const configured = (window as unknown as { __VSCODE_CONFIG__?: { initialSettingsPage?: unknown } })
      .__VSCODE_CONFIG__?.initialSettingsPage;
    return typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : null;
  }, []);

  React.useEffect(() => {
    registerRuntimeAPIs(apis);
    return () => registerRuntimeAPIs(null);
  }, [apis]);

  React.useEffect(() => {
    if (panelType !== 'settings' || !initialSettingsPage) {
      return;
    }
    setSettingsPage(initialSettingsPage);
  }, [initialSettingsPage, panelType, setSettingsPage]);

  useAppFontEffects();
  usePushVisibilityBeacon({ enabled: true });
  useWindowTitle();
  useRouter();

  React.useEffect(() => {
    document.documentElement.classList.toggle('wide-chat-layout', wideChatLayoutEnabled);
    return () => {
      document.documentElement.classList.remove('wide-chat-layout');
    };
  }, [wideChatLayoutEnabled]);

  React.useEffect(() => {
    void refreshGitHubAuthStatus(apis.github, { force: true });
  }, [apis.github, refreshGitHubAuthStatus]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const res = await fetch('/health', { method: 'GET' }).catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const data = (await res.json().catch(() => null)) as null | {
        planModeExperimentalEnabled?: unknown;
      };
      if (!data || cancelled) return;
      const raw = data.planModeExperimentalEnabled;
      const enabled = raw === true || raw === 1 || raw === '1' || raw === 'true';
      setPlanModeEnabled(enabled);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [setPlanModeEnabled]);

  React.useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(timeout);
  }, [clearError, error]);

  if (panelType === 'agentManager') {
    return (
      <ErrorBoundary>
        <SyncProvider sdk={opencodeClient.getSdkClient()} directory={syncDirectory}>
          <RuntimeAPIProvider apis={apis}>
            <TooltipProvider delayDuration={300} skipDelayDuration={150}>
              <div className="h-full text-foreground bg-background">
                <SyncAppEffects embeddedBackgroundWorkEnabled={true} />
                <AgentManagerView />
                <Toaster />
              </div>
            </TooltipProvider>
          </RuntimeAPIProvider>
        </SyncProvider>
      </ErrorBoundary>
    );
  }

  if (panelType === 'settings') {
    return (
      <ErrorBoundary>
        <SyncProvider sdk={opencodeClient.getSdkClient()} directory={syncDirectory}>
          <RuntimeAPIProvider apis={apis}>
            <TooltipProvider delayDuration={300} skipDelayDuration={150}>
              <div className="h-full text-foreground bg-background">
                <SyncAppEffects embeddedBackgroundWorkEnabled={true} />
                <React.Suspense fallback={null}>
                  <SettingsView
                    onClose={() => {
                      void apis.vscode?.executeCommand('openchamber.closeSettingsPanel');
                    }}
                    isWindowed
                  />
                </React.Suspense>
                <Toaster />
              </div>
            </TooltipProvider>
          </RuntimeAPIProvider>
        </SyncProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SyncProvider sdk={opencodeClient.getSdkClient()} directory={syncDirectory}>
        <RuntimeAPIProvider apis={apis}>
          <FireworksProvider>
            <TooltipProvider delayDuration={300} skipDelayDuration={150}>
              <div className="h-full text-foreground bg-background">
                <SyncAppEffects embeddedBackgroundWorkEnabled={true} />
                <VSCodeLayout />
                <Toaster />
              </div>
            </TooltipProvider>
          </FireworksProvider>
        </RuntimeAPIProvider>
      </SyncProvider>
    </ErrorBoundary>
  );
}
