// @effect-diagnostics nodeBuiltinImport:off -- Runs the repository's install script as a server would.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

const SCRIPT = NodePath.join(import.meta.dirname, "../../../../deploy/install.sh");
const ADDRESS = "majordome-2.tail1234.ts.net";
const LINK = `https://${ADDRESS}/pair#token=ONETIME`;

/** Stand-ins for what the script calls on a real server; each records how it was called. */
const STUBS: Record<string, string> = {
  id: '#!/bin/sh\necho "${STUB_UID:-0}"\n',
  uname: "#!/bin/sh\necho Linux\n",
  systemctl: "#!/bin/sh\nexit 0\n",
  curl: `#!/bin/sh
echo "curl $*" >>"$STUB_LOG"
for last; do :; done
case $1 in
  -fsSLO) echo "from $last" >"$(basename "$last")" ;;
  *) case $last in
       */install-updates.sh) echo 'echo "updates in $1"' ;;
       *) echo 'echo unexpected download; exit 1' ;;
     esac ;;
esac
`,
  docker: `#!/bin/sh
echo "docker $*" >>"$STUB_LOG"
case "$*" in
  "compose version") ;;
  "compose up -d --quiet-pull") ;;
  "compose exec -T tailscale "*)
    [ -z "\${STUB_NO_TAILSCALE:-}" ] || exit 1
    printf '{\\n  "Self": {\\n    "DNSName": "${ADDRESS}.",\\n    "Online": true\\n  }\\n}\\n' ;;
  "compose exec -T majordome majord pair") echo "${LINK}" ;;
  *) exit 1 ;;
esac
`,
  // A server that never joins is waited for; the test does not wait with it.
  sleep: "#!/bin/sh\nexit 0\n",
};

const made: Array<string> = [];
afterEach(() => {
  for (const directory of made.splice(0)) NodeFS.rmSync(directory, { recursive: true });
});

function server() {
  const root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "install")));
  made.push(root);
  const bin = NodePath.join(root, "bin");
  NodeFS.mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    NodeFS.writeFileSync(NodePath.join(bin, name), body, { mode: 0o755 });
  }
  const directory = NodePath.join(root, "majordome");
  const log = NodePath.join(root, "log");
  const run = (args: ReadonlyArray<string>, env: Record<string, string> = {}) => {
    try {
      const out = NodeChildProcess.execFileSync("sh", [SCRIPT, ...args], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          MAJORDOME_DIR: directory,
          STUB_LOG: log,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      return { ok: true, out };
    } catch (error) {
      const failed = error as { readonly stdout?: string; readonly stderr?: string };
      return { ok: false, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
    }
  };
  const env = () =>
    NodeFS.readFileSync(NodePath.join(directory, ".env"), "utf8").trim().split("\n");
  const calls = () => NodeFS.readFileSync(log, "utf8");
  return { directory, log, run, env, calls };
}

describe("deploy/install.sh", () => {
  it("starts Majordome, learns its address, and ends with a link to add it", () => {
    const { directory, run, env, calls } = server();
    const result = run(["tskey-auth-abc123"], { TZ: "Europe/Paris" });
    expect(result.out).toContain(`majordome: ready at https://${ADDRESS}`);
    expect(result.out).toContain(LINK);
    expect(result.out).toContain(`updates in ${directory}`);
    expect(result.ok).toBe(true);
    expect(env()).toEqual([
      "TS_AUTHKEY=tskey-auth-abc123",
      "TZ=Europe/Paris",
      `MAJORDOME_PUBLIC_URL=https://${ADDRESS}`,
    ]);
    // The key is a secret: only root reads the file.
    expect(NodeFS.statSync(NodePath.join(directory, ".env")).mode & 0o777).toBe(0o600);
    expect(NodeFS.existsSync(NodePath.join(directory, "docker-compose.yml"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(directory, "browser-seccomp.json"))).toBe(true);
    // Started once to join the network, and once more with its address.
    expect(calls().match(/docker compose up -d/g)).toHaveLength(2);
  });

  it("runs again without the key, and without restarting for an address it already has", () => {
    const { run, env, calls } = server();
    run(["tskey-auth-abc123"]);
    const again = run([]);
    expect(again.ok).toBe(true);
    expect(again.out).toContain(LINK);
    expect(env()).toContain("TS_AUTHKEY=tskey-auth-abc123");
    expect(calls().match(/docker compose up -d/g)).toHaveLength(3);
  });

  it("refuses anything that is not an auth key, before it touches the server", () => {
    const { run, log } = server();
    const secret = run(["tskey-client-abc"]);
    expect(secret.ok).toBe(false);
    expect(secret.out).toContain("that is a Tailscale secret, not a key");
    expect(run(["hello; rm -rf /"]).out).toContain("does not look like a Tailscale key");
    expect(run([]).out).toContain("give your Tailscale key");
    // Nothing was downloaded or started.
    expect(NodeFS.existsSync(log)).toBe(false);
  });

  it("asks for root", () => {
    const { run } = server();
    const result = run(["tskey-auth-abc123"], { STUB_UID: "501" });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("run this as root");
  });

  it("says what to do when the server never joins Tailscale", () => {
    const { run } = server();
    const result = run(["tskey-auth-abc123"], { STUB_NO_TAILSCALE: "1" });
    expect(result.ok).toBe(false);
    expect(result.out).toContain("did not join your Tailscale network");
  });
});
