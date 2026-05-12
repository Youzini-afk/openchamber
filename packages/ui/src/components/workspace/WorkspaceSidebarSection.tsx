import React from 'react';
import {
  RiAttachment2,
  RiChatNewLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFileAddLine,
  RiFileCopyLine,
  RiFileLine,
  RiFileZipLine,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkspaceEntry } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isWorkspaceArchivePath } from '@/lib/workspaceArchive';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useInputStore } from '@/sync/input-store';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';

type WorkspaceSidebarSectionProps = {
  mobileVariant?: boolean;
  setSessionSwitcherOpen?: (open: boolean) => void;
};

const TRASH_PATH = '.trash';
const TREE_INDENT_PX = 14;
const TREE_ROW_LEFT_PADDING_PX = 4;
const MAX_TREE_GUIDE_DEPTH = 18;
const TREE_GUIDE_LINE_CLASS = 'bg-muted-foreground/40 group-hover/workspace-row:bg-muted-foreground/60';

const entryDepthPadding = (depth: number): React.CSSProperties => ({
  paddingLeft: `${Math.min(depth, MAX_TREE_GUIDE_DEPTH) * TREE_INDENT_PX + TREE_ROW_LEFT_PADDING_PX}px`,
});

type TreeLineage = boolean[];

const TreeGuides: React.FC<{ depth: number; lineage: TreeLineage }> = ({ depth, lineage }) => {
  if (depth <= 0) return null;

  const visibleDepth = Math.min(depth, MAX_TREE_GUIDE_DEPTH);
  const currentDepth = visibleDepth - 1;
  const currentHasNextSibling = Boolean(lineage[depth - 1]);
  const currentX = TREE_ROW_LEFT_PADDING_PX + currentDepth * TREE_INDENT_PX + TREE_INDENT_PX / 2;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0" aria-hidden="true">
      {lineage.slice(0, Math.max(0, visibleDepth - 1)).map((hasNextSibling, index) => (
        hasNextSibling ? (
          <span
            key={`ancestor-${index}`}
            className={cn('absolute inset-y-0 w-[1.5px] rounded-full', TREE_GUIDE_LINE_CLASS)}
            style={{ left: `${TREE_ROW_LEFT_PADDING_PX + index * TREE_INDENT_PX + TREE_INDENT_PX / 2}px` }}
          />
        ) : null
      ))}
      <span
        className={cn(
          'absolute top-0 w-[1.5px] rounded-full',
          TREE_GUIDE_LINE_CLASS,
          currentHasNextSibling ? 'bottom-0' : 'h-1/2',
        )}
        style={{ left: `${currentX}px` }}
      />
      <span
        className={cn('absolute h-[1.5px] rounded-full', TREE_GUIDE_LINE_CLASS)}
        style={{
          left: `${currentX}px`,
          top: '50%',
          width: `${TREE_INDENT_PX / 2}px`,
        }}
      />
    </div>
  );
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

const isTrashRelativePath = (path: string): boolean => (
  path === TRASH_PATH || path.startsWith(`${TRASH_PATH}/`)
);

export const WorkspaceSidebarSection: React.FC<WorkspaceSidebarSectionProps> = ({
  mobileVariant = false,
  setSessionSwitcherOpen,
}) => {
  const { t } = useI18n();
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
  const renameEntry = useWorkspaceStore((state) => state.renameEntry);
  const deleteEntry = useWorkspaceStore((state) => state.deleteEntry);
  const uploadFiles = useWorkspaceStore((state) => state.uploadFiles);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const openTerminal = useWorkspaceStore((state) => state.openTerminal);
  const openGitPanel = useWorkspaceStore((state) => state.openGitPanel);
  const openArchiveDialog = useWorkspaceStore((state) => state.openArchiveDialog);
  const refreshGitStatus = useWorkspaceStore((state) => state.refreshGitStatus);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const addServerPathAttachment = useInputStore((state) => state.addServerPathAttachment);
  const didInitialLoadRef = React.useRef(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = React.useRef('');
  const [contextMenuPath, setContextMenuPath] = React.useState<string | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<WorkspaceEntry | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [renameSubmitting, setRenameSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (didInitialLoadRef.current) {
      return;
    }
    didInitialLoadRef.current = true;
    void useWorkspaceStore.getState().refreshWorkspace();
  }, []);

  const rootEntries = entriesByPath[''] ?? [];
  const isBusy = Boolean(loadingRoot || loadingPaths[''] || actionPending);
  const trashEntry = React.useMemo<WorkspaceEntry | null>(() => {
    if (!root?.features?.trash) return null;
    const mtimeMs = root.mtimeMs || 0;
    return {
      name: t('workspace.sidebar.trash.title'),
      path: `${root.root || '/workspace'}/${TRASH_PATH}`,
      relativePath: TRASH_PATH,
      type: 'directory',
      size: 0,
      modifiedAt: new Date(mtimeMs).toISOString(),
      mtimeMs,
    };
  }, [root, t]);

  const handleCreateFolder = React.useCallback(async (parent = '') => {
    const name = window.prompt(t('workspace.sidebar.prompt.newFolderName'));
    if (!name?.trim()) return;
    const entry = await createFolder(childPath(parent, name));
    if (entry) toast.success(t('workspace.sidebar.toast.folderCreated'));
  }, [createFolder, t]);

  const handleCreateFile = React.useCallback(async (parent = '') => {
    const name = window.prompt(t('workspace.sidebar.prompt.newFileName'));
    if (!name?.trim()) return;
    const entry = await createFile(childPath(parent, name), '');
    if (entry) toast.success(t('workspace.sidebar.toast.fileCreated'));
  }, [createFile, t]);

  const closeRenameDialog = React.useCallback(() => {
    setRenameTarget(null);
    setRenameDraft('');
    setRenameError(null);
    setRenameSubmitting(false);
  }, []);

  const openRenameDialog = React.useCallback((entry: WorkspaceEntry) => {
    setContextMenuPath(null);
    setRenameTarget(entry);
    setRenameDraft(entry.name);
    setRenameError(null);
  }, []);

  const validateRenameDraft = React.useCallback((name: string, currentName: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
      return t('workspace.sidebar.dialog.rename.invalidName');
    }
    if (trimmed === currentName) {
      return t('workspace.sidebar.dialog.rename.sameName');
    }
    return null;
  }, [t]);

  const handleRenameSubmit = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;

    const validation = validateRenameDraft(renameDraft, renameTarget.name);
    if (validation) {
      setRenameError(validation);
      return;
    }

    setRenameSubmitting(true);
    const renamed = await renameEntry(renameTarget.relativePath, renameDraft.trim());
    setRenameSubmitting(false);
    if (renamed) {
      toast.success(t('workspace.sidebar.toast.renamed'));
      closeRenameDialog();
    }
  }, [closeRenameDialog, renameDraft, renameEntry, renameTarget, t, validateRenameDraft]);

  const handleDelete = React.useCallback(async (entry: WorkspaceEntry) => {
    if (entry.relativePath === TRASH_PATH) return;
    const permanent = isTrashRelativePath(entry.relativePath);
    const confirmKey = permanent
      ? 'workspace.sidebar.confirm.permanentDelete'
      : 'workspace.sidebar.confirm.moveToTrash';
    if (!window.confirm(t(confirmKey, { name: entry.name }))) return;
    const ok = await deleteEntry(entry.relativePath, permanent ? { permanent: true } : undefined);
    if (ok) {
      toast.success(t(permanent
        ? 'workspace.sidebar.toast.permanentlyDeleted'
        : 'workspace.sidebar.toast.movedToTrash'));
    }
  }, [deleteEntry, t]);

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
      const uploaded = await uploadFiles(uploadTargetRef.current, files);
      if (uploaded.length > 0) {
        const firstArchive = uploaded.find((entry) => entry.type === 'file' && isWorkspaceArchivePath(entry.relativePath));
        toast.success(t('workspace.sidebar.toast.uploaded', { count: uploaded.length }), firstArchive ? {
          action: {
            label: t('workspace.archive.actions.extract'),
            onClick: () => openArchiveDialog(firstArchive.relativePath, 'new-folder'),
          },
        } : undefined);
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      toast.error(message || t('workspace.sidebar.toast.uploadFailed'));
    }
  }, [openArchiveDialog, t, uploadFiles]);

  const handleCopyPath = React.useCallback(async (entry: WorkspaceEntry) => {
    try {
      await navigator.clipboard?.writeText(entry.path || entry.relativePath);
      toast.success(t('workspace.sidebar.toast.pathCopied'));
    } catch {
      toast.error(t('workspace.sidebar.toast.copyFailed'));
    }
  }, [t]);

  const handleAddToSession = React.useCallback((entry: WorkspaceEntry) => {
    if (isTrashRelativePath(entry.relativePath)) return;
    const path = entry.path || entry.relativePath;
    addServerPathAttachment(path, entry.name, { entryType: entry.type });
    setActiveMainTab('chat');
    setSessionSwitcherOpen?.(false);
    if (!currentSessionId && !newSessionDraftOpen) {
      openNewSessionDraft();
    }
    toast.success(t('workspace.sidebar.toast.addedToSession', { name: entry.name }));
  }, [
    addServerPathAttachment,
    currentSessionId,
    newSessionDraftOpen,
    openNewSessionDraft,
    setActiveMainTab,
    setSessionSwitcherOpen,
    t,
  ]);

  const renderEntry = React.useCallback((entry: WorkspaceEntry, depth: number, lineage: TreeLineage = []): React.ReactNode => {
    const isDirectory = entry.type === 'directory';
    const isTrashRoot = entry.relativePath === TRASH_PATH;
    const isInsideTrash = isTrashRelativePath(entry.relativePath);
    const canUseProjectActions = isDirectory && !isInsideTrash;
    const isArchive = entry.type === 'file' && isWorkspaceArchivePath(entry.relativePath);
    const isExpanded = Boolean(expandedPaths[entry.relativePath]);
    const children = entriesByPath[entry.relativePath] ?? [];
    const gitLabel = getEntryGitLabel(entry);
    const menuOpen = contextMenuPath === entry.relativePath;

    return (
      <React.Fragment key={entry.relativePath}>
        <div
          className="group/workspace-row relative flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-interactive-hover"
          style={entryDepthPadding(depth)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenuPath(entry.relativePath);
          }}
        >
          <TreeGuides depth={depth} lineage={lineage} />
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
            {isTrashRoot ? (
              <RiDeleteBinLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : isDirectory ? (
              <RiFolderLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : isArchive ? (
              <RiFileZipLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
            {canUseProjectActions ? (
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
                  <TooltipContent side="bottom">{t('workspace.sidebar.menu.openChat')}</TooltipContent>
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
                  <TooltipContent side="bottom">{t('workspace.sidebar.menu.terminal')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                      onClick={() => openRenameDialog(entry)}
                    >
                      <RiEditLine className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('workspace.sidebar.menu.rename')}</TooltipContent>
                </Tooltip>
              </>
            ) : null}
            <DropdownMenu open={menuOpen} onOpenChange={(open) => setContextMenuPath(open ? entry.relativePath : null)}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label={t('workspace.sidebar.menu.aria')}
                  onClick={() => setContextMenuPath(entry.relativePath)}
                >
                  <RiMore2Line className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                {canUseProjectActions ? (
                  <>
                    <DropdownMenuItem onClick={() => void handleOpenChat(entry)}>
                      <RiChatNewLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.openChat')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleOpenFiles(entry)}>
                      <RiFolderLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.openFiles')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openGitPanel(entry.relativePath)}>
                      <RiGitBranchLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.git')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openTerminal(entry.relativePath)}>
                      <RiTerminalLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.terminal')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void handleCreateFolder(entry.relativePath)}>
                      <RiFolderAddLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.newFolder')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleCreateFile(entry.relativePath)}>
                      <RiFileAddLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.newFile')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleUploadClick(entry.relativePath)}>
                      <RiUpload2Line className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.upload')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void refreshGitStatus(entry.relativePath)}>
                      <RiRefreshLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.refreshGitStatus')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {isTrashRoot ? (
                  <DropdownMenuItem onClick={() => void loadDirectory(TRASH_PATH)}>
                    <RiRefreshLine className="mr-1.5 h-4 w-4" />
                    {t('workspace.sidebar.actions.refresh')}
                  </DropdownMenuItem>
                ) : (
                  <>
                    {isArchive && !isInsideTrash ? (
                      <>
                        <DropdownMenuItem onClick={() => openArchiveDialog(entry.relativePath, 'preview')}>
                          <RiFileZipLine className="mr-1.5 h-4 w-4" />
                          {t('workspace.archive.menu.preview')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openArchiveDialog(entry.relativePath, 'new-folder')}>
                          <RiFileZipLine className="mr-1.5 h-4 w-4" />
                          {t('workspace.archive.menu.extractNewFolder')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openArchiveDialog(entry.relativePath, 'merge')}>
                          <RiFileZipLine className="mr-1.5 h-4 w-4" />
                          {t('workspace.archive.menu.extractHere')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {!isInsideTrash ? (
                      <DropdownMenuItem onClick={() => handleAddToSession(entry)}>
                        <RiAttachment2 className="mr-1.5 h-4 w-4" />
                        {t('workspace.sidebar.menu.addToSession')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => void handleCopyPath(entry)}>
                      <RiFileCopyLine className="mr-1.5 h-4 w-4" />
                      {t('workspace.sidebar.menu.copyPath')}
                    </DropdownMenuItem>
                    {!isInsideTrash ? (
                      <DropdownMenuItem onClick={() => openRenameDialog(entry)}>
                        <RiEditLine className="mr-1.5 h-4 w-4" />
                        {t('workspace.sidebar.menu.rename')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => void handleDelete(entry)}
                    >
                      <RiDeleteBinLine className="mr-1.5 h-4 w-4" />
                      {isInsideTrash
                        ? t('workspace.sidebar.menu.permanentDelete')
                        : t('workspace.sidebar.menu.moveToTrash')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {isDirectory && isExpanded ? (
          <div className="space-y-0.5">
            {(loadingPaths[entry.relativePath] && children.length === 0) ? (
              <div className="px-2 py-1 typography-micro text-muted-foreground" style={entryDepthPadding(depth + 1)}>
                {t('workspace.sidebar.state.loading')}
              </div>
            ) : isTrashRoot && children.length === 0 ? (
              <div className="px-2 py-1 typography-micro text-muted-foreground" style={entryDepthPadding(depth + 1)}>
                {t('workspace.sidebar.trash.empty')}
              </div>
            ) : null}
            {children.map((child, index) => renderEntry(child, depth + 1, [...lineage, index < children.length - 1]))}
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
    handleCopyPath,
    handleAddToSession,
    handleOpenChat,
    handleOpenFiles,
    handleUploadClick,
    loadDirectory,
    loadingPaths,
    mobileVariant,
    contextMenuPath,
    openGitPanel,
    openArchiveDialog,
    openRenameDialog,
    openTerminal,
    refreshGitStatus,
    t,
    toggleExpandedPath,
  ]);

  return (
    <section className="space-y-1 py-1">
      <div className="flex items-center gap-1 px-0.5">
        <div className="min-w-0 flex-1">
          <div className="truncate typography-ui-label font-medium lowercase text-foreground">
            {t('workspace.sidebar.title')}
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
          <TooltipContent side="bottom">{t('workspace.sidebar.actions.terminal')}</TooltipContent>
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
          <TooltipContent side="bottom">{t('workspace.sidebar.actions.newFolder')}</TooltipContent>
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
          <TooltipContent side="bottom">{t('workspace.sidebar.actions.upload')}</TooltipContent>
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
          <TooltipContent side="bottom">{t('workspace.sidebar.actions.refresh')}</TooltipContent>
        </Tooltip>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploadChange}
      />

      <Dialog open={renameTarget !== null} onOpenChange={(open) => {
        if (!open) closeRenameDialog();
      }}>
        <DialogContent className="max-w-md">
          <form className="space-y-4" onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>{t('workspace.sidebar.dialog.rename.title')}</DialogTitle>
              <DialogDescription>
                {t('workspace.sidebar.dialog.rename.description', { name: renameTarget?.name ?? '' })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                value={renameDraft}
                onChange={(event) => {
                  setRenameDraft(event.currentTarget.value);
                  setRenameError(null);
                }}
                placeholder={t('workspace.sidebar.dialog.rename.placeholder')}
                aria-invalid={renameError ? true : undefined}
                autoFocus
              />
              {renameError ? (
                <p className="typography-micro text-[var(--status-error)]">
                  {renameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={closeRenameDialog}
                disabled={renameSubmitting}
              >
                {t('workspace.sidebar.dialog.rename.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={renameSubmitting || !renameDraft.trim()}
              >
                {t('workspace.sidebar.dialog.rename.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {error ? (
        <div className="rounded-md border border-[var(--status-error)]/30 px-2 py-1 typography-micro text-[var(--status-error)]">
          {error}
        </div>
      ) : null}

      <div className="space-y-0.5">
        {rootEntries.length === 0 && !trashEntry ? (
          <div className="px-1 py-1 typography-micro text-muted-foreground">
            {isBusy ? t('workspace.sidebar.state.loading') : t('workspace.sidebar.state.empty')}
          </div>
        ) : null}
        {rootEntries.length > 0 ? (
          rootEntries.map((entry, index) => renderEntry(entry, 0, [Boolean(trashEntry) || index < rootEntries.length - 1]))
        ) : null}
        {trashEntry ? renderEntry(trashEntry, 0, [false]) : null}
      </div>
    </section>
  );
};
