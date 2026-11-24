# Container image

`ghcr.io/wozacosta/majordome` is the server and web client from `Dockerfile`, run headless with
`majord serve`. Owners deploy it with `deploy/docker-compose.yml`; the user guide is
[Your server](../user/always-on-server.md).

## What is in it

- `/opt/majordome`: `apps/server/dist` (web client in `dist/client`) and the runtime externals the
  bundle leaves out, staged by `node scripts/build-cli-archive.ts stage-runtime`, the same
  selection the CLI archives ship.
- `majord` (and `t3`) on `PATH`, `git`, `gitleaks` (from the gitleaks image), and the pinned
  `claude` and `codex` CLIs. `age` encryption is the bundled `age-encryption` package; no binary.
- `HOME=/data` and `T3CODE_HOME=/data/majordome`: one volume holds Majordome's state, provider
  sign-ins (`~/.claude`, `~/.codex`) and the vaults (`/data/brain` by convention). The server runs
  as `node` (uid 1000).
- Health check: `GET /.well-known/t3/environment`, which needs no auth.

"Set up a server for me" writes the same compose file on the server it creates. It names `latest`
for the first start only: the nightly update (`deploy/install-updates.sh`, which its first boot
runs) reads `image-digest.txt` from the newest release and pins the image to that digest, so a
tag moved on the registry changes nothing on a running server. It sets two variables in its `.env`:
`MAJORDOME_HOSTNAME` (a name free on the tailnet) and `MAJORDOME_SETUP_SECRET` (a one-time pairing
secret, see [decisions](../decisions.md#servers-and-sync)). `serverMoveCompose.ts` and
`serverMoveUpdates.ts` hold copies of the compose file and the update script, since the packaged
app has no repository to read: change both together. A test fails when they differ.

Tailscale is a sidecar in the compose file, not part of the image. Majordome shares its network
namespace and binds `127.0.0.1`, and the sidecar's `TS_SERVE_CONFIG` publishes it over HTTPS on
the tailnet. The image has no `tailscale` CLI, so **Your phone** cannot manage Serve there; the
pairing output shows the container's address, and owners enter the token at their `*.ts.net`
address instead.

## Build and run locally

```bash
docker build -t majordome:local .
docker run --rm -p 127.0.0.1:3773:3773 -v majordome-local:/data majordome:local
```

The first lines of output include `Token:`; open `http://127.0.0.1:3773` and paste it. Remove the
test volume with `docker volume rm majordome-local`.

## Publish

`.github/workflows/container-image.yml` runs on `v*` tags and by hand, only in
`Wozacosta/majordome`. Each architecture builds on its own runner, then one job tags the joined
image: a tag publishes `<version>`, `<major>.<minor>` and `latest`; a manual run publishes `edge`
and `sha-<commit>`.

A tag build passes its version as the `MAJORDOME_VERSION` build arg, which the `Dockerfile` writes
into the package manifests before building, as the desktop release does with `--build-version`.
`majord --version`, the server's reported version and the web client then all say the release, and
the build fails if `majord --version` says anything else. Without the arg (a manual run, or
`docker build` locally) the image reports the version in `apps/server/package.json`.

After the first publish, check that the package is public in its GitHub
settings: owners' servers pull it without signing in.

## Bumping

- Node: `NODE_VERSION` in `Dockerfile` must equal `engines.node` in `package.json`; the build
  fails otherwise.
- Provider CLIs: `CLAUDE_CODE_VERSION` and `CODEX_VERSION` build args. Claude Code's auto-updater
  is off so the pinned version is the one that runs.
- gitleaks and Tailscale: the image tags in `Dockerfile` and `deploy/docker-compose.yml`.
- Browser sandbox: `deploy/browser-seccomp.json` is Docker's default seccomp profile
  (`moby/profiles`, `seccomp/default.json`) minified, plus one rule allowing `clone`, `setns` and
  `unshare`, so Chrome can sandbox itself with user namespaces. To refresh it, take the newer
  default, append that rule, and copy the result into `serverMoveSeccomp.ts`.
- Browser libraries: the `apt-get` list in `Dockerfile` follows `DEBIAN_PACKAGES` in
  `apps/server/src/preview/PreviewBrowserHost.ts`.
