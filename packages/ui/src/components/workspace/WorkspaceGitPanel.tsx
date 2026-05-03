import React from 'react';
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiRefreshLine,
  RiTerminalLine,
} from '@remixicon/react';

import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GitRemote, GitStatusFile } from '@/lib/api/types';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';

const EMPTY_GIT_REMOTES: GitRemote[] = [];
const EMPTY_GIT_FILES: GitStatusFile[] = [];

export const WorkspaceGitPanel: React.FC = () => {
  const { t } = useI18n();
  const gitPanel = useWorkspaceStore((state) => state.gitPanel);
  const status = useWorkspaceStore((state) => state.gitStatusByPath[gitPanel.path]);
  const log = useWorkspaceStore((state) => state.gitLogByPath[gitPanel.path]);
  const remotes = useWorkspaceStore((state) => state.gitRemotesByPath[gitPanel.path] ?? EMPTY_GIT_REMOTES);
  const actionPending = useWorkspaceStore((state) => state.actionPending);
  const error = useWorkspaceStore((state) => state.error);
  const closeGitPanel = useWorkspaceStore((state) => state.closeGitPanel);
  const refreshGitStatus = useWorkspaceStore((state) => state.refreshGitStatus);
  const loadGitLog = useWorkspaceStore((state) => state.loadGitLog);
  const loadGitRemotes = useWorkspaceStore((state) => state.loadGitRemotes);
  const gitFetch = useWorkspaceStore((state) => state.gitFetch);
  const gitPull = useWorkspaceStore((state) => state.gitPull);
  const gitPush = useWorkspaceStore((state) => state.gitPush);
  const gitCheckout = useWorkspaceStore((state) => state.gitCheckout);
  const gitCommit = useWorkspaceStore((state) => state.gitCommit);
  const openTerminal = useWorkspaceStore((state) => state.openTerminal);

  const [commitMessage, setCommitMessage] = React.useState('');
  const [checkoutBranch, setCheckoutBranch] = React.useState('');
  const [stageAll, setStageAll] = React.useState(false);
  const [selectedFiles, setSelectedFiles] = React.useState<Record<string, boolean>>({});

  const files = React.useMemo(() => status?.files ?? EMPTY_GIT_FILES, [status?.files]);
  const isRepo = status?.isGitRepository !== false && Boolean(status);
  const isBusy = Boolean(actionPending?.startsWith('git-'));

  React.useEffect(() => {
    if (!gitPanel.open || !gitPanel.path) {
      return;
    }
    void refreshGitStatus(gitPanel.path);
    void loadGitLog(gitPanel.path, { maxCount: 8 });
    void loadGitRemotes(gitPanel.path);
  }, [gitPanel.open, gitPanel.path, loadGitLog, loadGitRemotes, refreshGitStatus]);

  React.useEffect(() => {
    setSelectedFiles((prev) => {
      const next: Record<string, boolean> = {};
      for (const file of files) {
        next[file.path] = prev[file.path] ?? false;
      }
      return next;
    });
  }, [files]);

  const refreshAll = React.useCallback(async () => {
    if (!gitPanel.path) return;
    await Promise.all([
      refreshGitStatus(gitPanel.path),
      loadGitLog(gitPanel.path, { maxCount: 8 }),
      loadGitRemotes(gitPanel.path),
    ]);
  }, [gitPanel.path, loadGitLog, loadGitRemotes, refreshGitStatus]);

  const handleFetch = React.useCallback(async () => {
    if (!gitPanel.path) return;
    if (await gitFetch(gitPanel.path)) {
      toast.success(t('workspace.git.toast.fetched'));
    }
  }, [gitFetch, gitPanel.path, t]);

  const handlePull = React.useCallback(async () => {
    if (!gitPanel.path) return;
    const result = await gitPull(gitPanel.path);
    if (result) {
      toast.success(t('workspace.git.toast.pulled'));
      await refreshAll();
    }
  }, [gitPanel.path, gitPull, refreshAll, t]);

  const handlePush = React.useCallback(async () => {
    if (!gitPanel.path) return;
    const result = await gitPush(gitPanel.path);
    if (result) {
      toast.success(t('workspace.git.toast.pushed'));
      await refreshAll();
    }
  }, [gitPanel.path, gitPush, refreshAll, t]);

  const handleCheckout = React.useCallback(async () => {
    const branch = checkoutBranch.trim();
    if (!gitPanel.path || !branch) return;
    if (await gitCheckout(gitPanel.path, branch)) {
      toast.success(t('workspace.git.toast.checkedOut'));
      setCheckoutBranch('');
      await refreshAll();
    }
  }, [checkoutBranch, gitCheckout, gitPanel.path, refreshAll, t]);

  const handleCommit = React.useCallback(async () => {
    const message = commitMessage.trim();
    if (!gitPanel.path || !message) return;
    const filesToCommit = Object.entries(selectedFiles)
      .filter(([, selected]) => selected)
      .map(([file]) => file);
    if (!stageAll && filesToCommit.length === 0) {
      toast.error(t('workspace.git.toast.selectFiles'));
      return;
    }
    if (await gitCommit(gitPanel.path, message, {
      addAll: stageAll,
      files: stageAll ? undefined : filesToCommit,
    })) {
      toast.success(t('workspace.git.toast.committed'));
      setCommitMessage('');
      setStageAll(false);
      await refreshAll();
    }
  }, [commitMessage, gitCommit, gitPanel.path, refreshAll, selectedFiles, stageAll, t]);

  return (
    <Dialog open={gitPanel.open} onOpenChange={(open) => {
      if (!open) {
        closeGitPanel();
      }
    }}>
      <DialogContent className="h-[min(760px,calc(100vh-32px))] max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <RiGitBranchLine className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t('workspace.git.title', { path: gitPanel.path || t('workspace.git.workspace') })}</span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {status?.current || status?.tracking || t('workspace.git.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <div className="mb-3 rounded-md border border-[var(--status-error)]/30 px-3 py-2 typography-ui-label text-[var(--status-error)]">
              {error}
            </div>
          ) : null}

          {!status ? (
            <div className="py-8 text-center typography-ui-label text-muted-foreground">
              {t('workspace.git.state.loading')}
            </div>
          ) : !isRepo ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <RiGitBranchLine className="h-8 w-8 text-muted-foreground" />
              <div className="typography-ui-label text-foreground">{t('workspace.git.state.notRepository')}</div>
              <Button type="button" size="sm" variant="outline" onClick={() => openTerminal(gitPanel.path)}>
                <RiTerminalLine className="h-4 w-4" />
                {t('workspace.git.actions.terminal')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-border/60 px-3 py-2">
                  <div className="typography-micro text-muted-foreground">{t('workspace.git.summary.branch')}</div>
                  <div className="truncate typography-ui-label text-foreground">{status.current || '-'}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2">
                  <div className="typography-micro text-muted-foreground">{t('workspace.git.summary.remote')}</div>
                  <div className="truncate typography-ui-label text-foreground">{status.tracking || '-'}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2">
                  <div className="typography-micro text-muted-foreground">{t('workspace.git.summary.ahead')}</div>
                  <div className="typography-ui-label text-foreground">{status.ahead ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2">
                  <div className="typography-micro text-muted-foreground">{t('workspace.git.summary.behind')}</div>
                  <div className="typography-ui-label text-foreground">{status.behind ?? 0}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={refreshAll} disabled={isBusy}>
                  <RiRefreshLine className={cn('h-4 w-4', isBusy && 'animate-spin')} />
                  {t('workspace.git.actions.refresh')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleFetch} disabled={isBusy}>
                  <RiRefreshLine className="h-4 w-4" />
                  {t('workspace.git.actions.fetch')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handlePull} disabled={isBusy}>
                  <RiArrowDownLine className="h-4 w-4" />
                  {t('workspace.git.actions.pull')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handlePush} disabled={isBusy}>
                  <RiArrowUpLine className="h-4 w-4" />
                  {t('workspace.git.actions.push')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => openTerminal(gitPanel.path)}>
                  <RiTerminalLine className="h-4 w-4" />
                  {t('workspace.git.actions.terminal')}
                </Button>
              </div>

              <div className="space-y-2">
                <div className="typography-ui-label font-medium text-foreground">{t('workspace.git.section.checkout')}</div>
                <div className="flex gap-2">
                  <Input
                    value={checkoutBranch}
                    onChange={(event) => setCheckoutBranch(event.target.value)}
                    placeholder={t('workspace.git.placeholder.branch')}
                    className="h-8"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={handleCheckout} disabled={isBusy || !checkoutBranch.trim()}>
                    {t('workspace.git.actions.checkout')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="typography-ui-label font-medium text-foreground">{t('workspace.git.section.changes')}</div>
                  <label className="flex items-center gap-2 typography-micro text-muted-foreground">
                    <Checkbox checked={stageAll} onChange={setStageAll} ariaLabel={t('workspace.git.actions.stageAll')} />
                    {t('workspace.git.actions.stageAll')}
                  </label>
                </div>
                {files.length === 0 ? (
                  <div className="rounded-lg border border-border/60 px-3 py-3 typography-ui-label text-muted-foreground">
                    {t('workspace.git.state.clean')}
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60">
                    {files.map((file) => (
                      <label key={file.path} className="flex items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0">
                        <Checkbox
                          checked={stageAll || Boolean(selectedFiles[file.path])}
                          onChange={(checked) => setSelectedFiles((prev) => ({ ...prev, [file.path]: checked }))}
                          disabled={stageAll}
                          ariaLabel={t('workspace.git.actions.selectFile', { path: file.path })}
                        />
                        <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">{file.path}</span>
                        <span className="shrink-0 typography-micro text-muted-foreground">{file.index || file.working_dir}</span>
                      </label>
                    ))}
                  </div>
                )}
                <Textarea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder={t('workspace.git.placeholder.commitMessage')}
                  className="min-h-20"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCommit}
                  disabled={isBusy || !commitMessage.trim() || files.length === 0}
                >
                  <RiGitCommitLine className="h-4 w-4" />
                  {t('workspace.git.actions.commit')}
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="typography-ui-label font-medium text-foreground">{t('workspace.git.section.remotes')}</div>
                  <div className="space-y-1">
                    {remotes.length === 0 ? (
                      <div className="typography-ui-label text-muted-foreground">{t('workspace.git.state.none')}</div>
                    ) : remotes.map((remote) => (
                      <div key={remote.name} className="rounded-lg border border-border/60 px-3 py-2">
                        <div className="typography-ui-label text-foreground">{remote.name}</div>
                        <div className="truncate typography-micro text-muted-foreground">{remote.fetchUrl || remote.pushUrl}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="typography-ui-label font-medium text-foreground">{t('workspace.git.section.recentLog')}</div>
                  <div className="space-y-1">
                    {(log?.all ?? []).length === 0 ? (
                      <div className="typography-ui-label text-muted-foreground">{t('workspace.git.state.none')}</div>
                    ) : log?.all.map((entry) => (
                      <div key={entry.hash} className="rounded-lg border border-border/60 px-3 py-2">
                        <div className="truncate typography-ui-label text-foreground">{entry.message}</div>
                        <div className="truncate typography-micro text-muted-foreground">{entry.hash.slice(0, 8)} · {entry.author_name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={closeGitPanel}>
            {t('workspace.git.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
