import React from 'react';
import { Popover } from '@base-ui/react/popover';
import { RiFileEditLine, RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react';
import { toast } from '@/components/ui';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useGitStore, useIsGitRepo } from '@/stores/useGitStore';
import { useUIStore } from '@/stores/useUIStore';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { useMobileAppActions } from '@/apps/mobileAppContext';
import { sessionEvents } from '@/lib/sessionEvents';
import { normalizePath } from '@/components/session/sidebar/utils';
import { openFileInMainEditor } from '@/lib/openFileInMainEditor';
import {
    type ChangedFileEntry,
    type GitChangedFile,
    extractGitChangedFiles,
    getGitChangeKind,
    isGitFile,
    toAbsoluteChangedFilePath,
} from './changedFiles';
import { ChangedFilesList } from './ChangedFilesList';
import { changedFilesPopoverClassName, changedFilesPopoverStyle } from './changedFilesPopover';
import { useI18n } from '@/lib/i18n';

export const PendingChangesBar: React.FC = React.memo(() => {
    const { t } = useI18n();
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [revertingPaths, setRevertingPaths] = React.useState<Set<string>>(() => new Set());
    const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
    const runtime = React.useContext(RuntimeAPIContext);
    const isGitRepo = useIsGitRepo(currentDirectory);
    const gitStatus = useGitStore((s) =>
        currentDirectory ? s.directories.get(currentDirectory)?.status ?? null : null,
    );
    const ensureStatus = useGitStore((s) => s.ensureStatus);
    const fetchStatus = useGitStore((s) => s.fetchStatus);
    const mobileActions = useMobileAppActions();

    // Seed git store for currentDirectory so the bar can render independently of
    // DiffView/GitView/right-sidebar mounting. ensureStatus has a 5s staleness
    // gate and inFlightStatusFetchesByDirectory dedupes against concurrent callers.
    React.useEffect(() => {
        if (!currentDirectory || !runtime?.git) return;
        void ensureStatus(currentDirectory, runtime.git);
    }, [currentDirectory, runtime?.git, ensureStatus]);

    // Mirror the onGitRefreshHint listener that lives in DiffView/GitView so the
    // bar refreshes after mutating tools (edit/write/apply_patch/bash/...) even
    // when neither of those views is open — e.g. VS Code runtime.
    React.useEffect(() => {
        if (!currentDirectory || !runtime?.git) return;
        const git = runtime.git;
        return sessionEvents.onGitRefreshHint((hint) => {
            if (normalizePath(hint.directory) !== normalizePath(currentDirectory)) return;
            void fetchStatus(currentDirectory, git);
        });
    }, [currentDirectory, runtime?.git, fetchStatus]);

    const gitChangedFiles = React.useMemo<GitChangedFile[]>(() => {
        if (isGitRepo !== true || !gitStatus || gitStatus.isClean) return [];
        return extractGitChangedFiles(gitStatus.files, gitStatus.diffStats, currentDirectory);
    }, [isGitRepo, gitStatus, currentDirectory]);

    const changeSummary = React.useMemo(() => {
        let created = 0;
        let deleted = 0;
        let modified = 0;
        let totalAdded = 0;
        let totalRemoved = 0;

        for (const file of gitChangedFiles) {
            totalAdded += file.insertions;
            totalRemoved += file.deletions;

            const kind = getGitChangeKind(file);
            if (kind === 'created') {
                created += 1;
            } else if (kind === 'deleted') {
                deleted += 1;
            } else {
                modified += 1;
            }
        }

        return { created, deleted, modified, totalAdded, totalRemoved };
    }, [gitChangedFiles]);

    const handleOpenFile = (file: ChangedFileEntry) => {
        if (!currentDirectory) return;
        if (!isGitFile(file)) return;

        if (getGitChangeKind(file) === 'deleted') {
            handleViewDiff(file);
            return;
        }

        // Dedicated mobile root: open the per-file diff inside the mobile Changes surface.
        if (mobileActions) {
            mobileActions.openChanges({
                diffPath: file.relativePath,
                staged: file.hasStagedChanges && !file.hasWorkingChanges,
            });
            setIsExpanded(false);
            return;
        }

        const editor = runtime?.editor;
        if (editor) {
            const absolutePath = toAbsoluteChangedFilePath(file, currentDirectory);
            void editor.openFile(absolutePath);
            return;
        }

        const absolutePath = toAbsoluteChangedFilePath(file, currentDirectory);
        openFileInMainEditor(currentDirectory, absolutePath);
        setIsExpanded(false);
    };

    const handleViewDiff = (file: ChangedFileEntry) => {
        if (!currentDirectory) return;
        if (!isGitFile(file)) return;

        const store = useUIStore.getState();
        store.navigateToDiff(file.relativePath);
        if (store.isMobile) {
            store.setRightSidebarOpen(false);
        }
        setIsExpanded(false);
    };

    const handleRevertFile = async (file: ChangedFileEntry) => {
        if (!currentDirectory || !runtime?.git || !isGitFile(file)) return;

        const filePath = file.relativePath;
        setRevertingPaths((previous) => {
            const next = new Set(previous);
            next.add(filePath);
            return next;
        });

        try {
            await runtime.git.revertGitFile(currentDirectory, filePath);
            toast.success(t('gitView.toast.revertedFile', { path: filePath }));
            sessionEvents.requestGitRefresh({ directory: currentDirectory });
            await fetchStatus(currentDirectory, runtime.git);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('gitView.toast.revertFailed'));
        } finally {
            setRevertingPaths((previous) => {
                const next = new Set(previous);
                next.delete(filePath);
                return next;
            });
        }
    };

    if (isGitRepo !== true) return null;
    if (gitChangedFiles.length === 0) return null;

    const summarySegments = [
        changeSummary.modified > 0
            ? t('chat.pendingChanges.summary.modified', { count: changeSummary.modified })
            : null,
        changeSummary.created > 0
            ? t('chat.pendingChanges.summary.created', { count: changeSummary.created })
            : null,
        changeSummary.deleted > 0
            ? t('chat.pendingChanges.summary.deleted', { count: changeSummary.deleted })
            : null,
    ].filter(Boolean);

    const hasLineStats = changeSummary.totalAdded > 0 || changeSummary.totalRemoved > 0;

    return (
        <Popover.Root open={isExpanded} onOpenChange={setIsExpanded}>
            <Popover.Trigger
                render={
                    <button
                        type="button"
                        className="flex min-w-0 max-w-full items-center gap-1 text-left text-muted-foreground"
                    >
                        <RiFileEditLine className="h-3.5 w-3.5 flex-shrink-0 text-[var(--status-warning)]" />
                        <span className="min-w-0 inline-flex items-center gap-1 typography-ui-label text-foreground">
                            {summarySegments.map((segment, index) => (
                                <span key={segment} className="shrink-0">
                                    {index > 0 ? <span className="text-muted-foreground"> · </span> : null}
                                    {segment}
                                </span>
                            ))}
                        </span>
                        <span className="status-row__changed-label min-w-0 typography-ui-label text-foreground truncate">
                            {t('chat.pendingChanges.changedInWorkspace')}
                        </span>
                        {hasLineStats ? (
                            <span className="text-[0.75rem] tabular-nums inline-flex items-baseline gap-1 flex-shrink-0">
                                <span style={{ color: 'var(--status-success)' }}>+{changeSummary.totalAdded}</span>
                                <span style={{ color: 'var(--status-error)' }}>-{changeSummary.totalRemoved}</span>
                            </span>
                        ) : null}
                        {isExpanded ? (
                            <RiArrowUpSLine className="h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                            <RiArrowDownSLine className="h-3.5 w-3.5 flex-shrink-0" />
                        )}
                    </button>
                }
            />
            <Popover.Portal>
                <Popover.Positioner side="top" align="start" sideOffset={4} collisionPadding={8}>
                    <Popover.Popup
                        style={changedFilesPopoverStyle}
                        className={`${changedFilesPopoverClassName} transition-all duration-150 ease-out data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95`}
                    >
                        <ChangedFilesList
                            files={gitChangedFiles}
                            currentDirectory={currentDirectory}
                            onOpenFile={handleOpenFile}
                            onViewDiff={handleViewDiff}
                            onRevertFile={handleRevertFile}
                            revertingPaths={revertingPaths}
                        />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
});

PendingChangesBar.displayName = 'PendingChangesBar';
