import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import {
  installTerminalGitHubAuth,
  isTerminalGitHubAuthConfigured,
} from './terminal-auth.js';

const makeTempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-gh-terminal-'));

describe('terminal GitHub auth helpers', () => {
  it('writes the active OpenChamber GitHub account to gh hosts.yml', () => {
    const homeDir = makeTempHome();
    const authFilePath = path.join(homeDir, '.config', 'openchamber', 'github-auth.json');

    const result = installTerminalGitHubAuth({
      auth: {
        accessToken: 'gho_test_token',
        user: { login: 'youzini' },
      },
      homeDir,
      authFilePath,
      configureGit: false,
    });

    const hostsPath = path.join(homeDir, '.config', 'gh', 'hosts.yml');
    const hosts = YAML.parse(fs.readFileSync(hostsPath, 'utf8'));

    expect(result.ghConfigPath).toBe(hostsPath);
    expect(hosts).toEqual({
      'github.com': {
        git_protocol: 'https',
        oauth_token: 'gho_test_token',
        user: 'youzini',
      },
    });
    expect(isTerminalGitHubAuthConfigured({
      auth: { accessToken: 'gho_test_token' },
      homeDir,
      authFilePath,
    }).configured).toBe(true);
  });

  it('installs a Git credential helper without storing the token in git config', () => {
    const homeDir = makeTempHome();
    const authFilePath = path.join(homeDir, '.config', 'openchamber', 'github-auth.json');
    const spawnSync = vi.fn(() => ({ status: 0, error: null, stderr: Buffer.from('') }));

    const result = installTerminalGitHubAuth({
      auth: {
        accessToken: 'gho_secret',
        user: { login: 'youzini' },
      },
      homeDir,
      authFilePath,
      spawnSync,
    });

    const helper = fs.readFileSync(result.helperPath, 'utf8');
    expect(helper).toContain(JSON.stringify(authFilePath));
    expect(helper).not.toContain('gho_secret');
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      [
        'config',
        '--global',
        '--replace-all',
        'credential.https://github.com.helper',
        expect.stringContaining('git-credential-openchamber-github.cjs'),
      ],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('rejects terminal sync when no active GitHub token exists', () => {
    expect(() => installTerminalGitHubAuth({
      auth: null,
      homeDir: makeTempHome(),
      authFilePath: path.join(makeTempHome(), 'github-auth.json'),
    })).toThrow('GitHub is not connected');
  });
});
