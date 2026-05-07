# syntax=docker/dockerfile:1
FROM oven/bun:1.3.6 AS base
WORKDIR /app

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/web/package.json ./packages/web/
COPY packages/desktop/package.json ./packages/desktop/
COPY packages/electron/package.json ./packages/electron/
COPY packages/vscode/package.json ./packages/vscode/
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS builder
WORKDIR /app
COPY . .
RUN bun run build:web

FROM oven/bun:1.3.6 AS runtime
WORKDIR /home/openchamber

ARG TARGETARCH
ARG GO_VERSION=1.26.2
ARG NODE_VERSION=24.15.0

ENV PATH=/usr/local/node/bin:/usr/local/go/bin:${PATH}

RUN set -eux; \
  apt-get update && apt-get install -y --no-install-recommends \
  bash \
  build-essential \
  ca-certificates \
  cmake \
  curl \
  git \
  jq \
  less \
  maven \
  default-jdk-headless \
  openssh-client \
  python3 \
  python3-dev \
  python3-pip \
  python3-venv \
  pkg-config \
  ripgrep \
  unzip \
  wget \
  xz-utils \
  zip \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -nv -O /tmp/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && echo "6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b  /tmp/githubcli-archive-keyring.gpg" | sha256sum -c - \
  && cat /tmp/githubcli-archive-keyring.gpg > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "$arch" in \
    amd64|x86_64) \
      go_arch="amd64"; \
      go_sha="990e6b4bbba816dc3ee129eaeaf4b42f17c2800b88a2166c265ac1a200262282"; \
      node_arch="x64"; \
      node_sha="472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6"; \
      ;; \
    arm64|aarch64) \
      go_arch="arm64"; \
      go_sha="c958a1fe1b361391db163a485e21f5f228142d6f8b584f6bef89b26f66dc5b23"; \
      node_arch="arm64"; \
      node_sha="f3d5a797b5d210ce8e2cb265544c8e482eaedcb8aa409a8b46da7e8595d0dda0"; \
      ;; \
    *) echo "Unsupported Docker target architecture: $arch" >&2; exit 1 ;; \
  esac \
  && wget -nv -O "/tmp/go${GO_VERSION}.linux-${go_arch}.tar.gz" "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" \
  && echo "${go_sha}  /tmp/go${GO_VERSION}.linux-${go_arch}.tar.gz" | sha256sum -c - \
  && rm -rf /usr/local/go \
  && tar -C /usr/local -xzf "/tmp/go${GO_VERSION}.linux-${go_arch}.tar.gz" \
  && mkdir -p /usr/local/node \
  && wget -nv -O "/tmp/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  && echo "${node_sha}  /tmp/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" | sha256sum -c - \
  && tar -C /usr/local/node --strip-components=1 -xJf "/tmp/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  && gh --version \
  && go version \
  && java -version \
  && node --version \
  && npm --version \
  && python3 --version \
  && rg --version \
  && rm -rf /var/lib/apt/lists/* /tmp/githubcli-archive-keyring.gpg /tmp/go*.tar.gz /tmp/node-*.tar.xz

# Replace the base image's 'bun' user (UID 1000) with 'openchamber'
# so mounted volumes with 1000:1000 ownership work correctly.
RUN userdel bun \
  && groupadd -g 1000 openchamber \
  && useradd -u 1000 -g 1000 -m -s /bin/bash openchamber \
  && chown -R openchamber:openchamber /home/openchamber

# Switch to openchamber user
USER openchamber

ENV NPM_CONFIG_PREFIX=/home/openchamber/.npm-global
ENV GOPATH=/home/openchamber/go
ENV CARGO_HOME=/home/openchamber/.cargo
ENV RUSTUP_HOME=/home/openchamber/.rustup
ENV PATH=/home/openchamber/node_modules/.bin:${NPM_CONFIG_PREFIX}/bin:${GOPATH}/bin:${CARGO_HOME}/bin:${PATH}

RUN mkdir -p /home/openchamber/.local /home/openchamber/.config /home/openchamber/.ssh /home/openchamber/go /home/openchamber/.cargo /home/openchamber/.rustup && \
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable && \
  rustc --version && cargo --version && \
  go install golang.org/x/tools/gopls@latest && \
  npm config set prefix /home/openchamber/.npm-global && mkdir -p /home/openchamber/.npm-global && \
  npm install -g opencode-ai pnpm tsx typescript typescript-language-server yarn && \
  gopls version && tsc --version && typescript-language-server --version && pnpm --version && yarn --version

# cloudflared 2026.3.0 - update digest explicitly when upgrading
COPY --from=cloudflare/cloudflared@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0 /usr/local/bin/cloudflared /usr/local/bin/cloudflared

ENV NODE_ENV=production

COPY scripts/docker-entrypoint.sh /home/openchamber/openchamber-entrypoint.sh

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/web/package.json ./packages/web/package.json
COPY --from=builder /app/packages/web/bin ./packages/web/bin
COPY --from=builder /app/packages/web/server ./packages/web/server
COPY --from=builder /app/packages/web/dist ./packages/web/dist

EXPOSE 3000

ENTRYPOINT ["sh", "/home/openchamber/openchamber-entrypoint.sh"]
