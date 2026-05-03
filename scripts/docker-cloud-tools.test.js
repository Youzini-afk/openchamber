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
});
