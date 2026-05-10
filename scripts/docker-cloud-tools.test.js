import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const appDockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
const runtimeBaseDockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile.base'), 'utf8');
const dockerAppWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/docker-app.yml'), 'utf8');

const getAptInstallPackages = () => {
  const matches = runtimeBaseDockerfile.matchAll(/apt-get install\s+-y\s+--no-install-recommends\s+([\s\S]*?)(?=\s+&&)/g);
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
  it('declares the runtime base image build arg before any FROM instruction', () => {
    const runtimeArgIndex = appDockerfile.indexOf('ARG RUNTIME_BASE_IMAGE=ghcr.io/youzini-afk/openchamber-runtime-base:main');
    const firstFromIndex = appDockerfile.indexOf('FROM ');

    expect(runtimeArgIndex).toBeGreaterThanOrEqual(0);
    expect(firstFromIndex).toBeGreaterThan(runtimeArgIndex);
  });

  it('keeps the app image thin and based on the prebuilt runtime base image', () => {
    expect(appDockerfile).toContain('ARG RUNTIME_BASE_IMAGE=ghcr.io/youzini-afk/openchamber-runtime-base:main');
    expect(appDockerfile).toContain('FROM ${RUNTIME_BASE_IMAGE} AS runtime');
    expect(appDockerfile).toContain('OPENCHAMBER_LOW_MEMORY_BUILD=1 bun run build:web');
    expect(appDockerfile).toContain('COPY --from=builder /app/packages/web/dist ./packages/web/dist');
    expect(appDockerfile).toContain('ENTRYPOINT ["sh", "/home/openchamber/openchamber-entrypoint.sh"]');
    expect(appDockerfile).not.toContain('apt-get install');
    expect(appDockerfile).not.toContain('rustup.rs');
    expect(appDockerfile).not.toContain('playwright install --with-deps chrome');
  });

  it('publishes runtime base and app images from one ordered workflow', () => {
    expect(dockerAppWorkflow).toContain('name: Docker Images');
    expect(dockerAppWorkflow).toContain('build-runtime-base:');
    expect(dockerAppWorkflow).toContain('build-app:');
    expect(dockerAppWorkflow).toContain('needs: [build-runtime-base]');
    expect(dockerAppWorkflow).toContain('Dockerfile.base');
    expect(dockerAppWorkflow).toContain('BASE_IMAGE_NAME: youzini-afk/openchamber-runtime-base');
    expect(dockerAppWorkflow).toContain('APP_IMAGE_NAME: youzini-afk/openchamber');
    expect(dockerAppWorkflow).toContain('DEFAULT_RUNTIME_BASE_IMAGE: ghcr.io/youzini-afk/openchamber-runtime-base:main');
    expect(dockerAppWorkflow).not.toContain('github.repository_owner }}/openchamber');
  });

  it('installs GitHub CLI from the official apt repository', () => {
    expect(runtimeBaseDockerfile).toContain('https://cli.github.com/packages');
    expect(runtimeBaseDockerfile).toContain('githubcli-archive-keyring.gpg');
    expect(runtimeBaseDockerfile).toContain('6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b');
    expect(aptInstallPackages.has('gh')).toBe(true);
  });

  it('installs ripgrep as a system CLI and verifies both cloud tools at build time', () => {
    expect(aptInstallPackages.has('ripgrep')).toBe(true);
    expect(runtimeBaseDockerfile).toContain('gh --version');
    expect(runtimeBaseDockerfile).toContain('rg --version');
  });

  it('installs Google Chrome for Playwright MCP browser QA on amd64 images', () => {
    expect(runtimeBaseDockerfile).toContain('npx --yes playwright install --with-deps chrome');
    expect(runtimeBaseDockerfile).toContain('google-chrome --version');
    expect(runtimeBaseDockerfile).toContain('Google Chrome for Linux is only available on amd64');
  });

  it('uses official Rust and Go toolchains instead of stale apt packages', () => {
    expect(aptInstallPackages.has('rustc')).toBe(false);
    expect(aptInstallPackages.has('cargo')).toBe(false);
    expect(aptInstallPackages.has('golang-go')).toBe(false);
    expect(runtimeBaseDockerfile).toContain('https://sh.rustup.rs');
    expect(runtimeBaseDockerfile).toContain('ARG GO_VERSION=1.26.2');
    expect(runtimeBaseDockerfile).toContain('ARG GOPLS_VERSION=v0.21.1');
    expect(runtimeBaseDockerfile).toContain('https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz');
    expect(runtimeBaseDockerfile).toContain('rustc --version');
    expect(runtimeBaseDockerfile).toContain('cargo --version');
    expect(runtimeBaseDockerfile).toContain('go version');
    expect(runtimeBaseDockerfile).toContain('go install golang.org/x/tools/gopls@${GOPLS_VERSION}');
    expect(runtimeBaseDockerfile).toContain('gopls version');
  });

  it('uses official Node.js LTS instead of the apt nodejs package', () => {
    expect(aptInstallPackages.has('nodejs')).toBe(false);
    expect(aptInstallPackages.has('npm')).toBe(false);
    expect(runtimeBaseDockerfile).toContain('ARG NODE_VERSION=24.15.0');
    expect(runtimeBaseDockerfile).toContain('https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz');
    expect(runtimeBaseDockerfile).toContain('node --version');
    expect(runtimeBaseDockerfile).toContain('npm --version');
  });
});
