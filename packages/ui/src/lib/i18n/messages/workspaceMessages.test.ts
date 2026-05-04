import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { dict as enDict } from './en';
import { dict as zhDict } from './zh-CN';

const WORKSPACE_KEYS = [
  'workspace.sidebar.title',
  'workspace.sidebar.actions.terminal',
  'workspace.sidebar.actions.newFolder',
  'workspace.sidebar.actions.upload',
  'workspace.sidebar.actions.refresh',
  'workspace.sidebar.menu.openChat',
  'workspace.sidebar.menu.openFiles',
  'workspace.sidebar.menu.git',
  'workspace.sidebar.menu.terminal',
  'workspace.sidebar.menu.newFolder',
  'workspace.sidebar.menu.newFile',
  'workspace.sidebar.menu.upload',
  'workspace.sidebar.menu.refreshGitStatus',
  'workspace.sidebar.menu.copyPath',
  'workspace.sidebar.menu.rename',
  'workspace.sidebar.menu.moveToTrash',
  'workspace.sidebar.state.empty',
  'workspace.sidebar.state.loading',
  'workspace.sidebar.dialog.rename.title',
  'workspace.sidebar.dialog.rename.description',
  'workspace.sidebar.dialog.rename.placeholder',
  'workspace.sidebar.dialog.rename.invalidName',
  'workspace.sidebar.dialog.rename.sameName',
  'workspace.sidebar.dialog.rename.cancel',
  'workspace.sidebar.dialog.rename.submit',
  'workspace.terminal.actions.restart',
  'workspace.terminal.actions.stop',
  'workspace.terminal.actions.restore',
  'workspace.terminal.actions.maximize',
  'workspace.terminal.actions.hide',
  'workspace.terminal.status.connecting',
  'workspace.terminal.status.processExited',
  'workspace.terminal.error.createFailed',
  'workspace.terminal.error.connectionFailed',
  'workspace.terminal.error.sendFailed',
  'workspace.git.title',
  'workspace.git.workspace',
  'workspace.git.description',
  'workspace.git.state.loading',
  'workspace.git.state.notRepository',
  'workspace.git.state.clean',
  'workspace.git.state.none',
  'workspace.git.actions.terminal',
  'workspace.git.actions.refresh',
  'workspace.git.actions.fetch',
  'workspace.git.actions.pull',
  'workspace.git.actions.push',
  'workspace.git.actions.checkout',
  'workspace.git.actions.stageAll',
  'workspace.git.actions.selectFile',
  'workspace.git.actions.commit',
  'workspace.git.actions.close',
  'workspace.git.summary.branch',
  'workspace.git.summary.remote',
  'workspace.git.summary.ahead',
  'workspace.git.summary.behind',
  'workspace.git.section.checkout',
  'workspace.git.section.changes',
  'workspace.git.section.remotes',
  'workspace.git.section.recentLog',
  'workspace.git.placeholder.branch',
  'workspace.git.placeholder.commitMessage',
  'workspace.git.toast.fetched',
  'workspace.git.toast.pulled',
  'workspace.git.toast.pushed',
  'workspace.git.toast.checkedOut',
  'workspace.git.toast.selectFiles',
  'workspace.git.toast.committed',
] as const;

const testDir = dirname(fileURLToPath(import.meta.url));
const SAME_IN_CHINESE = new Set<string>([
  'workspace.sidebar.menu.git',
  'workspace.git.title',
]);

describe('workspace sidebar messages', () => {
  test('has Chinese translations for workspace controls', () => {
    for (const key of WORKSPACE_KEYS) {
      expect(enDict[key]).toBeTruthy();
      expect(zhDict[key]).toBeTruthy();
      if (!SAME_IN_CHINESE.has(key)) {
        expect(zhDict[key]).not.toBe(enDict[key]);
      }
    }
  });

  test('workspace rows expose a native context menu handler', () => {
    const source = readFileSync(
      resolve(testDir, '../../../components/workspace/WorkspaceSidebarSection.tsx'),
      'utf8',
    );

    expect(source).toContain('onContextMenu');
  });

  test('workspace rename uses a localized dialog instead of a native prompt', () => {
    const source = readFileSync(
      resolve(testDir, '../../../components/workspace/WorkspaceSidebarSection.tsx'),
      'utf8',
    );

    expect(source).toContain("t('workspace.sidebar.dialog.rename.title')");
    expect(source).toContain("t('workspace.sidebar.dialog.rename.submit')");
    expect(source).not.toContain("window.prompt(t('workspace.sidebar.prompt.renameTo')");
  });

  test('workspace terminal and git overlays use localized messages', () => {
    const terminalSource = readFileSync(
      resolve(testDir, '../../../components/workspace/WorkspaceTerminalDialog.tsx'),
      'utf8',
    );
    const gitSource = readFileSync(
      resolve(testDir, '../../../components/workspace/WorkspaceGitPanel.tsx'),
      'utf8',
    );

    expect(terminalSource).toContain("t('workspace.terminal.actions.restart')");
    expect(gitSource).toContain("t('workspace.git.actions.refresh')");
  });

  test('workspace terminal stream does not reconnect on ordinary re-renders', () => {
    const source = readFileSync(
      resolve(testDir, '../../../components/workspace/WorkspaceTerminalDialog.tsx'),
      'utf8',
    );

    expect(source).toContain('activeTerminalIdRef.current === sessionId');
    expect(source).toContain('startStream(dialog.directoryKey, activeTabId, terminalSessionId)');
    expect(source).not.toContain('cleanupRef.current?.();');
  });
});
