# syntax=docker/dockerfile:1.7
# Majordome's always-on server: the same server as the desktop app, headless, state in /data.
# Build: docker build -t majordome .   Run: see deploy/docker-compose.yml.
# A release passes --build-arg MAJORDOME_VERSION=<version>; without it the server reports the
# version in apps/server/package.json.

# Keep in step with package.json "engines.node"; the build stage checks it.
ARG NODE_VERSION=26.13.1

FROM node:${NODE_VERSION}-trixie-slim AS build
ARG NODE_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json pnpm-workspace.yaml ./
RUN test "$(node -p 'require("./package.json").engines.node')" = "$NODE_VERSION" \
  || { echo "NODE_VERSION does not match package.json engines.node" >&2; exit 1; }
RUN npm install -g "vite-plus@$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' pnpm-workspace.yaml)"
COPY . .
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN --mount=type=cache,id=majordome-pnpm-store,target=/root/.local/share/pnpm/store \
  vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
# The server and its web client read their version from the manifests, as in the desktop build.
ARG MAJORDOME_VERSION=
RUN if [ -n "$MAJORDOME_VERSION" ]; then \
    node scripts/update-release-package-versions.ts "$MAJORDOME_VERSION"; \
  fi
RUN vp run --filter t3 build
RUN --mount=type=cache,id=majordome-pnpm-store,target=/root/.local/share/pnpm/store \
  node scripts/build-cli-archive.ts stage-runtime \
    --arch "$(node -p 'process.arch')" --output-dir /out
# The staged server must start and say the release's version ("majord v1.2.3"), or the build fails.
RUN reported="$(node /out/dist/bin.mjs --version)" \
  && echo "$reported" \
  && case "$reported" in \
    *"v${MAJORDOME_VERSION}"*) ;; \
    *) echo "Expected version ${MAJORDOME_VERSION}." >&2; exit 1 ;; \
  esac

FROM ghcr.io/gitleaks/gitleaks:v8.30.1 AS secret-scan

FROM node:${NODE_VERSION}-trixie-slim
# Provider CLIs the server starts for agent turns. Bump deliberately.
ARG CLAUDE_CODE_VERSION=2.1.325
ARG CODEX_VERSION=0.169.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client tini procps \
  && rm -rf /var/lib/apt/lists/*
# What the built-in browser needs to start: Chrome's libraries (DEBIAN_PACKAGES in
# apps/server/src/preview/PreviewBrowserHost.ts) and a font to draw text with.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libnss3 libglib2.0-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libdbus-1-3 \
    libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libxkbcommon0 \
    libgbm1 libasound2t64 libexpat1 fontconfig fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}" \
  && npm cache clean --force
COPY --from=secret-scan /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=build /out /opt/majordome
RUN printf '#!/bin/sh\nexec node /opt/majordome/dist/bin.mjs "$@"\n' > /usr/local/bin/majord \
  && chmod 755 /usr/local/bin/majord \
  && ln -s majord /usr/local/bin/t3 \
  && mkdir -p /data \
  && chown node:node /data \
  && echo 'PRETTY_HOSTNAME="Always-on server"' > /etc/machine-info

# HOME is the volume too, so provider sign-ins (~/.claude, ~/.codex) and git settings survive updates.
ENV HOME=/data \
  T3CODE_HOME=/data/majordome \
  T3CODE_HOST=0.0.0.0 \
  T3CODE_PORT=3773 \
  DISABLE_AUTOUPDATER=1 \
  NODE_ENV=production
USER node
WORKDIR /data
VOLUME /data
EXPOSE 3773
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3773/.well-known/t3/environment').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["tini", "--", "majord"]
CMD ["serve"]
