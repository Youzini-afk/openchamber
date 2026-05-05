import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');

const getAptInstallPackages = () => {
  const matches = dockerfile.matchAll(/apt-get install\s+-y\s+--no-install-recommends\s+([\s\S]*?)(?=\s+&&)/g);
  return new Set(Array.from(matches).flatMap((match) => (
    match[1]
      .replace(/\\/g, ' ')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
  )));
};

const aptInstallPackages = getAptInstallPackages();

describe('cloud Docker toolbelt', () => {
  it('installs GitHub CLI from the official apt repository', () => {
    expect(dockerfile).toContain('https://cli.github.com/packages');
    expect(dockerfile).toContain('githubcli-archive-keyring.gpg');
    expect(dockerfile).toContain('6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b');
    expect(aptInstallPackages.has('gh')).toBe(true);
  });

  it('installs ripgrep as a system CLI and verifies both cloud tools at build time', () => {
    expect(aptInstallPackages.has('ripgrep')).toBe(true);
    expect(dockerfile).toContain('gh --version');
    expect(dockerfile).toContain('rg --version');
  });

  it('uses official Rust and Go toolchains instead of stale apt packages', () => {
    expect(aptInstallPackages.has('rustc')).toBe(false);
    expect(aptInstallPackages.has('cargo')).toBe(false);
    expect(aptInstallPackages.has('golang-go')).toBe(false);
    expect(dockerfile).toContain('https://sh.rustup.rs');
    expect(dockerfile).toContain('ARG GO_VERSION=1.26.2');
    expect(dockerfile).toContain('https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz');
    expect(dockerfile).toContain('rustc --version');
    expect(dockerfile).toContain('cargo --version');
    expect(dockerfile).toContain('go version');
  });

  it('uses official Node.js LTS instead of the apt nodejs package', () => {
    expect(aptInstallPackages.has('nodejs')).toBe(false);
    expect(aptInstallPackages.has('npm')).toBe(false);
    expect(dockerfile).toContain('ARG NODE_VERSION=24.15.0');
    expect(dockerfile).toContain('https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz');
    expect(dockerfile).toContain('node --version');
    expect(dockerfile).toContain('npm --version');
  });
});
