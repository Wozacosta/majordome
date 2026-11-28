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
# vite-plus no longer brings its own pnpm, so install the one package.json names.
RUN npm install -g "vite-plus@$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' pnpm-workspace.yaml)" \
  "$(node -p 'require("./package.json").packageManager')"
COPY . .
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN --mount=type=cache,id=majordome-pnpm-store,target=/root/.local/share/pnpm/store \
  vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
# The server and its web client read their version from the manifests, as in the desktop build.
ARG MAJORDOME_VERSION=
RUN if [ -n "$MAJORDOME_VERSION" ]; then \
    node scripts/update-release-package-versions.ts "$MAJORDOME_VERSION"; \
  fi
# Majordome's account service, which a release names; without it the server has no accounts.
ARG T3CODE_CLERK_PUBLISHABLE_KEY=
ENV T3CODE_CLERK_PUBLISHABLE_KEY=$T3CODE_CLERK_PUBLISHABLE_KEY
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

# Bitwarden's Secrets Manager CLI, for the Bitwarden secret source. Checked against the checksums
# its release publishes; bump the version and both sums together.
FROM debian:trixie-slim AS bws
ARG TARGETARCH
ARG BWS_VERSION=2.1.0
ARG BWS_SHA256_AMD64=ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860
ARG BWS_SHA256_ARM64=18253757286e119d450133a87eb463bf8c1ce418ce24c834f4f250d60cba6f9e
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
    amd64) triple=x86_64-unknown-linux-gnu; sum="$BWS_SHA256_AMD64" ;; \
    arm64) triple=aarch64-unknown-linux-gnu; sum="$BWS_SHA256_ARM64" ;; \
    *) echo "No bws build for $TARGETARCH." >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /tmp/bws.zip \
    "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-${triple}-${BWS_VERSION}.zip" \
  && echo "${sum}  /tmp/bws.zip" | sha256sum -c - \
  && unzip -q /tmp/bws.zip bws -d /out \
  && /out/bws --version

# Google's Antigravity, which runs Gemini. In the image, a hosted server signs in to Gemini with
# no download, and the 280 MB program stays off its small volume. The server finds it on PATH as
# `agy`. Checked against the sums in Google's release manifests, whose `url` names the release:
# https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json
# and linux_arm64.json. Bump the release and both sums together.
FROM debian:trixie-slim AS antigravity
ARG TARGETARCH
ARG ANTIGRAVITY_RELEASE=1.5.19-4821414830800896
ARG ANTIGRAVITY_SHA512_AMD64=8160da6ceef2b7b62bb4a630b54b3fb4ee5283377509230736880c4ba4815e848a25cf346954a98134b647eb2f5d34e0364e77fbf74367ffd7dc29c525ddd82d
ARG ANTIGRAVITY_SHA512_ARM64=eeecedfc2a63af281e245d73bb69f949a17c6d3ebcd3d023220056ddcc05e204a00d1d0ea77f68741b2fc15a1f66f740bc0e3bf800d734721c60938e61653010
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
    amd64) folder=linux-x64; archive=cli_linux_x64.tar.gz; sum="$ANTIGRAVITY_SHA512_AMD64" ;; \
    arm64) folder=linux-arm; archive=cli_linux_arm64.tar.gz; sum="$ANTIGRAVITY_SHA512_ARM64" ;; \
    *) echo "No Antigravity build for $TARGETARCH." >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /tmp/antigravity.tar.gz \
    "https://storage.googleapis.com/antigravity-public/antigravity-cli/${ANTIGRAVITY_RELEASE}/${folder}/${archive}" \
  && echo "${sum}  /tmp/antigravity.tar.gz" | sha512sum -c - \
  && mkdir /out \
  && tar -xzf /tmp/antigravity.tar.gz -C /out antigravity \
  && mv /out/antigravity /out/agy \
  && chmod 755 /out/agy

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
COPY --from=bws /out/bws /usr/local/bin/bws
COPY --from=antigravity /out/agy /usr/local/bin/agy
COPY --from=build /out /opt/majordome
RUN printf '#!/bin/sh\nexec node /opt/majordome/dist/bin.mjs "$@"\n' > /usr/local/bin/majord \
  && chmod 755 /usr/local/bin/majord \
  && ln -s majord /usr/local/bin/t3 \
  && mkdir -p /data \
  && chown node:node /data \
  && echo 'PRETTY_HOSTNAME="Your server"' > /etc/machine-info

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
