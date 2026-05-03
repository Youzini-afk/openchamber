import React from 'react';
import {
  RiChatNewLine,
  RiFileAddLine,
  RiFileLine,
  RiFolderAddLine,
  RiFolderLine,
  RiGitBranchLine,
  RiMore2Line,
  RiRefreshLine,
  RiTerminalLine,
  RiUpload2Line,
} from '@remixicon/react';

import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkspaceEntry } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';

type WorkspaceSidebarSectionProps = {
  mobileVariant?: boolean;
  setSessionSwitcherOpen?: (open: boolean) => void;
};

const entryDepthPadding = (depth: number): React.CSSProperties => ({
  paddingLeft: `${Math.min(depth, 6) * 12 + 4}px`,
});

const toBase64 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
};

const childPath = (parent: string, name: string): string => {
  const trimmedName = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
  if (!trimmedName) return parent;
  return parent ? `${parent}/${trimmedName}` : trimmedName;
};

const getEntryGitLabel = (entry: WorkspaceEntry): string | null => {
  const git = entry.git;
  if (!git) return null;
  const branch = git.branch || 'git';
  const sync = git.ahead || git.behind ? ` ${git.ahead}/${git.behind}` : '';
  return `${branch}${git.dirty ? '*' : ''}${sync}`;
};

export const WorkspaceSidebarSection: React.FC<WorkspaceSidebarSectionProps> = ({
  mobileVariant = false,
  setSessionSwitcherOpen,
}) => {
  const root = useWorkspaceStore((state) => state.root);
  const entriesByPath = useWorkspaceStore((state) => state.entriesByPath);
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths);
  const loadingRoot = useWorkspaceStore((state) => state.loadingRoot);
  const loadingPaths = useWorkspaceStore((state) => state.loadingPaths);
  const actionPending = useWorkspaceStore((state) => state.actionPending);
  const error = useWorkspaceStore((state) => state.error);
  const refreshWorkspace = useWorkspaceStore((state) => state.refreshWorkspace);
  const loadDirectory = useWorkspaceStore((state) => state.loadDirectory);
  const toggleExpandedPath = useWorkspaceStore((state) => state.toggleExpandedPath);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const createFile = useWorkspaceStore((state) => state.createFile);
  const moveEntry = useWorkspaceStore((state) => state.moveEntry);
  const deleteEntry = useWorkspaceStore((state) => state.deleteEntry);
  const uploadFiles = useWorkspaceStore((state) => state.uploadFiles);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const openTerminal = useWorkspaceStore((state) => state.openTerminal);
  const openGitPanel = useWorkspaceStore((state) => state.openGitPanel);
  const refreshGitStatus = useWorkspaceStore((state) => state.refreshGitStatus);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const didInitialLoadRef = React.useRef(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = React.useRef('');

  React.useEffect(() => {
    if (didInitialLoadRef.current) {
      return;
    }
    didInitialLoadRef.current = true;
    void useWorkspaceStore.getState().refreshWorkspace();
  }, []);

  const rootEntries = entriesByPath[''] ?? [];
  const isBusy = Boolean(loadingRoot || loadingPaths[''] || actionPending);

  const handleCreateFolder = React.useCallback(async (parent = '') => {
    const name = window.prompt('New folder name');
    if (!name?.trim()) return;
    const entry = await createFolder(childPath(parent, name));
    if (entry) toast.success('Folder created');
  }, [createFolder]);

  const handleCreateFile = React.useCallback(async (parent = '') => {
    const name = window.prompt('New file name');
    if (!name?.trim()) return;
    const entry = await createFile(childPath(parent, name), '');
    if (entry) toast.success('File created');
  }, [createFile]);

  const handleRename = React.useCallback(async (entry: WorkspaceEntry) => {
    const nextName = window.prompt('Rename to', entry.name);
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    const parent = entry.relativePath.includes('/')
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
      : '';
    const moved = await moveEntry(entry.relativePath, childPath(parent, nextName));
    if (moved) toast.success('Renamed');
  }, [moveEntry]);

  const handleDelete = React.useCallback(async (entry: WorkspaceEntry) => {
    if (!window.confirm(`Move "${entry.name}" to trash?`)) return;
    const ok = await deleteEntry(entry.relativePath);
    if (ok) toast.success('Moved to trash');
  }, [deleteEntry]);

  const handleOpenChat = React.useCallback(async (entry: WorkspaceEntry) => {
    if (entry.type !== 'directory') return;
    const project = await openProject(entry.relativePath);
    if (!project) return;
    setActiveMainTab('chat');
    setSessionSwitcherOpen?.(false);
    openNewSessionDraft({ directoryOverride: project.path });
  }, [openNewSessionDraft, openProject, setActiveMainTab, setSessionSwitcherOpen]);

  const handleOpenFiles = React.useCallback(async (entry: WorkspaceEntry) => {
    if (entry.type !== 'directory') return;
    const project = await openProject(entry.relativePath);
    if (!project) return;
    setActiveMainTab('files');
    setSessionSwitcherOpen?.(false);
  }, [openProject, setActiveMainTab, setSessionSwitcherOpen]);

  const handleUploadClick = React.useCallback((target = '') => {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  }, []);

  const handleUploadChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    try {
      const payload = await Promise.all(files.map(async (file) => ({
        name: file.name,
        contentBase64: await toBase64(file),
      })));
      const uploaded = await uploadFiles(uploadTargetRef.current, payload);
      if (uploaded.length > 0) {
        toast.success(`${uploaded.length} uploaded`);
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      toast.error(message || 'Upload failed');
    }
  }, [uploadFiles]);

  const renderEntry = React.useCallback((entry: WorkspaceEntry, depth: number): React.ReactNode => {
    const isDirectory = entry.type === 'directory';
    const isExpanded = Boolean(expandedPaths[entry.relativePath]);
    const children = entriesByPath[entry.relativePath] ?? [];
    const gitLabel = getEntryGitLabel(entry);

    return (
      <React.Fragment key={entry.relativePath}>
        <div
          className="group/workspace-row flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-interactive-hover"
          style={entryDepthPadding(depth)}
        >
          <button
            type="button"
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => {
              if (!isDirectory) return;
              toggleExpandedPath(entry.relativePath);
              if (!isExpanded) {
                void loadDirectory(entry.relativePath);
              }
            }}
          >
            {isDirectory ? (
              <RiFolderLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate typography-ui-label lowercase text-foreground">
              {entry.name}
            </span>
            {gitLabel ? (
              <span className="shrink-0 truncate rounded-[6px] border border-border/60 px-1.5 py-0.5 typography-micro text-muted-foreground">
                {gitLabel}
              </span>
            ) : null}
          </button>

          <div className={cn(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            mobileVariant ? 'opacity-100' : 'opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100',
          )}>
            {isDirectory ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                      onClick={() => void handleOpenChat(entry)}
                    >
                      <RiChatNewLine className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open Chat</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                      onClick={() => openTerminal(entry.relativePath)}
                    >
                      <RiTerminalLine className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Terminal</TooltipContent>
                </Tooltip>
              </>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label="Workspace menu"
                >
                  <RiMore2Line className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                {isDirectory ? (
                  <>
                    <DropdownMenuItem onClick={() => void handleOpenChat(entry)}>
                      <RiChatNewLine className="mr-1.5 h-4 w-4" />
                      Open Chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleOpenFiles(entry)}>
                      <RiFolderLine className="mr-1.5 h-4 w-4" />
                      Open Files
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openGitPanel(entry.relativePath)}>
                      <RiGitBranchLine className="mr-1.5 h-4 w-4" />
                      Git
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openTerminal(entry.relativePath)}>
                      <RiTerminalLine className="mr-1.5 h-4 w-4" />
                      Terminal
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void handleCreateFolder(entry.relativePath)}>
                      <RiFolderAddLine className="mr-1.5 h-4 w-4" />
                      New Folder
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleCreateFile(entry.relativePath)}>
                      <RiFileAddLine className="mr-1.5 h-4 w-4" />
                      New File
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleUploadClick(entry.relativePath)}>
                      <RiUpload2Line className="mr-1.5 h-4 w-4" />
                      Upload
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void refreshGitStatus(entry.relativePath)}>
                      <RiRefreshLine className="mr-1.5 h-4 w-4" />
                      Refresh Git Status
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(entry.path || entry.relativePath)}>
                  Copy Path
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleRename(entry)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void handleDelete(entry)}
                >
                  Move to Trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {isDirectory && isExpanded ? (
          <div className="space-y-0.5">
            {(loadingPaths[entry.relativePath] && children.length === 0) ? (
              <div className="px-2 py-1 typography-micro text-muted-foreground" style={entryDepthPadding(depth + 1)}>
                loading...
              </div>
            ) : null}
            {children.map((child) => renderEntry(child, depth + 1))}
          </div>
        ) : null}
      </React.Fragment>
    );
  }, [
    entriesByPath,
    expandedPaths,
    handleCreateFile,
    handleCreateFolder,
    handleDelete,
    handleOpenChat,
    handleOpenFiles,
    handleRename,
    handleUploadClick,
    loadDirectory,
    loadingPaths,
    mobileVariant,
    openGitPanel,
    openTerminal,
    refreshGitStatus,
    toggleExpandedPath,
  ]);

  return (
    <section className="space-y-1 py-1">
      <div className="flex items-center gap-1 px-0.5">
        <div className="min-w-0 flex-1">
          <div className="truncate typography-ui-label font-medium lowercase text-foreground">
            Workspace
          </div>
          <div className="truncate typography-micro text-muted-foreground">
            {root?.root || '/workspace'}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => openTerminal('')}
            >
              <RiTerminalLine className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Terminal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => void handleCreateFolder('')}
            >
              <RiFolderAddLine className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => handleUploadClick('')}
            >
              <RiUpload2Line className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Upload</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => void refreshWorkspace()}
              disabled={isBusy}
            >
              <RiRefreshLine className={cn('h-4 w-4', isBusy && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploadChange}
      />

      {error ? (
        <div className="rounded-md border border-[var(--status-error)]/30 px-2 py-1 typography-micro text-[var(--status-error)]">
          {error}
        </div>
      ) : null}

      <div className="space-y-0.5">
        {rootEntries.length === 0 ? (
          <div className="px-1 py-1 typography-micro text-muted-foreground">
            {isBusy ? 'loading...' : 'empty'}
          </div>
        ) : (
          rootEntries.map((entry) => renderEntry(entry, 0))
        )}
      </div>
    </section>
  );
};
