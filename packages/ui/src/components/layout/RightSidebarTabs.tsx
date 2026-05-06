import React from 'react';
import { RiBookletLine, RiFolder3Line, RiGitBranchLine } from '@remixicon/react';

import { SortableTabsStrip } from '@/components/ui/sortable-tabs-strip';
import { ProjectNotesTodoPanel } from '@/components/session/ProjectNotesTodoPanel';
import { GitView } from '@/components/views';
import { useGitStore } from '@/stores/useGitStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { formatDirectoryName } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { WorkspaceSidebarSection } from '@/components/workspace/WorkspaceSidebarSection';

type RightTab = 'git' | 'files' | 'context';
const RIGHT_SIDEBAR_GIT_DIRECTORY_STORAGE_KEY = 'oc.rightSidebar.gitDirectory';

const normalizeDirectoryPath = (value?: string | null): string => (
  (value || '').replace(/\\/g, '/').replace(/\/+$/g, '')
);

const readStoredGitDirectory = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(RIGHT_SIDEBAR_GIT_DIRECTORY_STORAGE_KEY);
    return stored?.trim() || null;
  } catch {
    return null;
  }
};

const writeStoredGitDirectory = (directory: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (directory?.trim()) {
      window.localStorage.setItem(RIGHT_SIDEBAR_GIT_DIRECTORY_STORAGE_KEY, directory.trim());
    } else {
      window.localStorage.removeItem(RIGHT_SIDEBAR_GIT_DIRECTORY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; the selector still works for the current page lifetime.
  }
};

/**
 * Keeps git status fresh while the right sidebar is open.
 * Replaces the GitPollingProvider removed in commit b2d5ccb4.
 * The previous polling ran globally; now we only refresh when the sidebar is open.
 */
function useRightSidebarGitSync(directory: string | undefined, isSidebarOpen: boolean) {
  const { git } = useRuntimeAPIs();
  const ensureStatus = useGitStore((state) => state.ensureStatus);

  React.useEffect(() => {
    if (!directory || !git || !isSidebarOpen) return;

    void ensureStatus(directory, git);

    const POLL_INTERVAL = 10_000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void ensureStatus(directory, git);
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [directory, git, isSidebarOpen, ensureStatus]);
}

const ContextSidebarPanel: React.FC = () => {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const projects = useProjectsStore((state) => state.projects);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const gitDirectories = useGitStore((state) => state.directories);

  const activeProject = React.useMemo(() => {
    if (activeProjectId) {
      return projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
    }
    return projects[0] ?? null;
  }, [activeProjectId, projects]);

  const projectRef = React.useMemo(() => {
    if (!activeProject) {
      return null;
    }
    return {
      id: activeProject.id,
      path: activeProject.path,
    };
  }, [activeProject]);

  const projectLabel = React.useMemo(() => {
    if (!activeProject) {
      return null;
    }
    return activeProject.label?.trim()
      || formatDirectoryName(activeProject.path, homeDirectory)
      || activeProject.path;
  }, [activeProject, homeDirectory]);

  const canCreateWorktree = React.useMemo(() => {
    if (!activeProject) {
      return false;
    }
    return gitDirectories.get(activeProject.path)?.isGitRepo === true;
  }, [activeProject, gitDirectories]);

  return (
    <div className="h-full min-h-0 overflow-auto bg-sidebar">
      <ProjectNotesTodoPanel
        projectRef={projectRef}
        projectLabel={projectLabel}
        canCreateWorktree={canCreateWorktree}
      />
    </div>
  );
};

const WorkspaceFilesPanel: React.FC = () => (
  <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
    <ScrollableOverlay outerClassName="flex-1 min-h-0" className="px-3 py-2">
      <WorkspaceSidebarSection />
    </ScrollableOverlay>
  </div>
);

const RightSidebarGitPanel: React.FC = () => {
  const sessionDirectory = useEffectiveDirectory();
  const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen);
  const [selectedDirectory, setSelectedDirectory] = React.useState<string | null>(() => readStoredGitDirectory());

  const gitDirectory = selectedDirectory || sessionDirectory || null;
  const isFollowingSession = Boolean(
    !selectedDirectory
    || (sessionDirectory && normalizeDirectoryPath(selectedDirectory) === normalizeDirectoryPath(sessionDirectory))
  );

  useRightSidebarGitSync(gitDirectory ?? undefined, isRightSidebarOpen);

  const handleDirectoryChange = React.useCallback((directory: string) => {
    const normalized = directory.trim();
    const nextDirectory = normalized
      && (!sessionDirectory || normalizeDirectoryPath(normalized) !== normalizeDirectoryPath(sessionDirectory))
      ? normalized
      : null;
    setSelectedDirectory(nextDirectory);
    writeStoredGitDirectory(nextDirectory);
  }, [sessionDirectory]);

  const handleFollowSession = React.useCallback(() => {
    setSelectedDirectory(null);
    writeStoredGitDirectory(null);
  }, []);

  return (
    <GitView
      directoryOverride={gitDirectory}
      showDirectorySelector
      sessionDirectory={sessionDirectory ?? null}
      isFollowingSessionDirectory={isFollowingSession}
      onDirectoryChange={handleDirectoryChange}
      onFollowSessionDirectory={handleFollowSession}
    />
  );
};

export const RightSidebarTabs: React.FC = () => {
  const { t } = useI18n();
  const rightSidebarTab = useUIStore((state) => state.rightSidebarTab);
  const setRightSidebarTab = useUIStore((state) => state.setRightSidebarTab);

  const tabItems = React.useMemo(() => [
    {
      id: 'git',
      label: t('layout.rightSidebar.git'),
      icon: <RiGitBranchLine className="h-3.5 w-3.5" />,
    },
    {
      id: 'files',
      label: t('layout.rightSidebar.files'),
      icon: <RiFolder3Line className="h-3.5 w-3.5" />,
    },
    {
      id: 'context',
      label: t('layout.rightSidebar.context'),
      icon: <RiBookletLine className="h-3.5 w-3.5" />,
    },
  ], [t]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      <div className="h-9 bg-sidebar pt-1 px-2">
        <SortableTabsStrip
          items={tabItems}
          activeId={rightSidebarTab}
          onSelect={(tabID) => setRightSidebarTab(tabID as RightTab)}
          layoutMode="fit"
          variant="active-pill"
          className="h-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {rightSidebarTab === 'git' && <RightSidebarGitPanel />}
        {rightSidebarTab === 'files' && <WorkspaceFilesPanel />}
        {rightSidebarTab === 'context' && <ContextSidebarPanel />}
      </div>
    </div>
  );
};
