import React from 'react';

import { isVSCodeRuntime } from '@/lib/desktop';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import { WorkspaceTerminalDialog } from './WorkspaceTerminalDialog';

export const WorkspaceOverlays: React.FC = () => {
  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);
  const terminalOpen = useWorkspaceStore((state) => state.terminalDialog.open);
  const gitPanelOpen = useWorkspaceStore((state) => state.gitPanel.open);

  if (isVSCode) {
    return null;
  }

  return (
    <>
      {terminalOpen ? <WorkspaceTerminalDialog /> : null}
      {gitPanelOpen ? <WorkspaceGitPanel /> : null}
    </>
  );
};
