/**
 * Syncs a vault with its git remote after a save: fetch, rebase onto what arrived, scan what is
 * about to leave, push. Never force-pushes. A conflict aborts the rebase and leaves the vault as it
 * was. Callers hold the vault's lock.
 */

import * as Effect from "effect/Effect";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { hasUnfinishedMerge, identityEnv, listLines, ownerIdentity } from "./vaultAutosave.ts";
import { scanForSecrets } from "./vaultSecretScan.ts";

const NETWORK_TIMEOUT_MS = 120_000;
/**
 * The newest commit whose history passed the secret scan; local, never pushed. A remote with no
 * shared history gets the whole history scanned once: run commits and older history never were,
 * and another remote may be on a more private host.
 */
const SCANNED_REF = "refs/majordome/secret-scanned";

export interface VaultRemote {
  readonly name: string;
  readonly url: string;
  /** The local branch being synced. */
  readonly branch: string;
  /** The branch on the remote it syncs with. */
  readonly remoteBranch: string;
}

/**
 * The remote this vault syncs with: `preferred` when it exists (the one Majordome added), else
 * the current branch's upstream remote, else `origin`, else the only remote. Null when there is
 * none, or HEAD is detached.
 */
export const resolveVaultRemote = Effect.fn("majordome.resolveVaultRemote")(function* (input: {
  readonly cwd: string;
  readonly preferred: string | null;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const read = (args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "majordome.vaultRemote", cwd: input.cwd, args, allowNonZeroExit: true })
      .pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")));
  const branch = yield* read(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch === "") return null;
  const remotes = listLines(yield* read(["remote"]));
  if (remotes.length === 0) return null;
  const upstreamRemote = yield* read(["config", "--get", `branch.${branch}.remote`]);
  const name =
    [input.preferred, upstreamRemote, "origin"].find(
      (candidate): candidate is string => !!candidate && remotes.includes(candidate),
    ) ?? (remotes.length === 1 ? remotes[0] : undefined);
  if (name === undefined) return null;
  const url = yield* read(["remote", "get-url", name]);
  const merge =
    name === upstreamRemote ? yield* read(["config", "--get", `branch.${branch}.merge`]) : "";
  return {
    name,
    url,
    branch,
    remoteBranch: merge.startsWith("refs/heads/") ? merge.slice("refs/heads/".length) : branch,
  } satisfies VaultRemote;
});

/** The host a remote URL points at; null for a folder on this computer. */
export function remoteHost(url: string): string | null {
  const scp = /^[^/@:]+@([^:/]+):/.exec(url);
  if (scp?.[1]) return scp[1].toLowerCase();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** A page for the remote, when it is on GitHub. */
export function remoteWebUrl(url: string): string | null {
  if (remoteHost(url) !== "github.com") return null;
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

export type SyncResult =
  | { readonly status: "synced"; readonly pushed: boolean }
  | {
      readonly status: "skipped";
      readonly reason: "unsaved-changes" | "unfinished-merge";
    }
  | { readonly status: "conflict"; readonly files: ReadonlyArray<string> }
  | { readonly status: "secret"; readonly files: ReadonlyArray<string> }
  | { readonly status: "failed"; readonly message: string };

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("hint:")) ?? "";

/**
 * The ssh command for background syncs. They can't answer an SSH agent's approval prompt (Bitwarden,
 * 1Password), so with a key file on disk they skip the agent, and they never wait for input.
 */
export function backgroundSshCommand(input: { readonly hasKeyFile: boolean }): string {
  return [
    "ssh",
    "-o BatchMode=yes",
    "-o ConnectTimeout=20",
    ...(input.hasKeyFile ? ["-o IdentityAgent=none"] : []),
  ].join(" ");
}

type LocalSection = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export const syncVault = Effect.fn("majordome.syncVault")(function* (input: {
  readonly cwd: string;
  readonly remote: VaultRemote;
  readonly gitleaks: string | null;
  /** Extra environment for network commands, such as a sign-in header. Never logged. */
  readonly credentialEnv?: Readonly<Record<string, string>>;
  /** Runs the steps that change the vault; fetch and push run outside it. */
  readonly local?: LocalSection;
  /** `GIT_SSH_COMMAND` for fetch and push, see `backgroundSshCommand`. */
  readonly sshCommand?: string;
}) {
  const local: LocalSection = input.local ?? ((effect) => effect);
  const git = yield* GitVcsDriver.GitVcsDriver;
  const { cwd, remote } = input;
  const identity = yield* ownerIdentity(cwd);
  const env = { ...identityEnv(identity), GIT_TERMINAL_PROMPT: "0" };
  const run = (args: ReadonlyArray<string>, options?: { readonly network?: boolean }) =>
    git.execute({
      operation: "majordome.vaultSync",
      cwd,
      args,
      allowNonZeroExit: true,
      env: options?.network
        ? {
            ...env,
            ...(input.sshCommand === undefined ? {} : { GIT_SSH_COMMAND: input.sshCommand }),
            ...input.credentialEnv,
          }
        : env,
      ...(options?.network ? { timeoutMs: NETWORK_TIMEOUT_MS } : {}),
    });

  const ready = yield* local(
    Effect.gen(function* () {
      if (yield* hasUnfinishedMerge(cwd)) {
        return { status: "skipped", reason: "unfinished-merge" } as SyncResult;
      }
      // A rebase needs a clean tree; whatever is unsaved goes with the next save.
      if ((yield* run(["status", "--porcelain"])).stdout.trim() !== "") {
        return { status: "skipped", reason: "unsaved-changes" } as SyncResult;
      }
      return null;
    }),
  );
  if (ready !== null) return ready;

  const fetch = yield* run(["fetch", "--quiet", remote.name], { network: true });
  if (fetch.exitCode !== 0) {
    return {
      status: "failed",
      message: firstLine(fetch.stderr) || "Could not reach the backup.",
    } as SyncResult;
  }
  const remoteRef = `refs/remotes/${remote.name}/${remote.remoteBranch}`;
  const hasRemoteBranch =
    (yield* run(["rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`])).exitCode === 0;

  // Rebasing re-creates commits; unsigned, so it never waits on a signing prompt.
  const rebased = yield* local(
    Effect.gen(function* () {
      if (!hasRemoteBranch) return null;
      const behind = Number(
        (yield* run(["rev-list", "--count", `HEAD..${remoteRef}`])).stdout.trim(),
      );
      if (!(behind > 0)) return null;
      const rebase = yield* run([
        "-c",
        "commit.gpgsign=false",
        "rebase",
        "--quiet",
        "--no-autostash",
        remoteRef,
      ]);
      if (rebase.exitCode === 0) return null;
      const files = listLines((yield* run(["diff", "--name-only", "--diff-filter=U"])).stdout);
      yield* run(["rebase", "--abort"]);
      return { status: "conflict", files } as SyncResult;
    }),
  );
  if (rebased !== null) return rebased;

  // Pinned, so a commit made meanwhile is neither sent nor marked scanned without a scan.
  const head = (yield* run(["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
  const onRemote = hasRemoteBranch ? [remoteRef] : [];
  const ahead = Number(
    (yield* run(["rev-list", "--count", head, "--not", ...onRemote])).stdout.trim(),
  );
  if (!(ahead > 0)) return { status: "synced", pushed: false } as SyncResult;

  if (input.gitleaks !== null) {
    const hasScanned =
      (yield* run(["rev-parse", "--verify", "--quiet", `${SCANNED_REF}^{commit}`])).exitCode === 0;
    const exclude = [...onRemote, ...(hasScanned ? [SCANNED_REF] : [])];
    const unscanned = exclude.length === 0 ? [head] : [head, "--not", ...exclude];
    const toScan = Number((yield* run(["rev-list", "--count", ...unscanned])).stdout.trim());
    if (toScan > 0) {
      const scan = yield* scanForSecrets({
        gitleaks: input.gitleaks,
        cwd,
        target: { logOpts: unscanned.join(" ") },
      });
      if (scan.status === "found") return { status: "secret", files: scan.files } as SyncResult;
      if (scan.status === "failed") {
        return { status: "failed", message: "The secret scan did not finish." } as SyncResult;
      }
      yield* local(run(["update-ref", SCANNED_REF, head]));
    }
  }

  const push = yield* run(
    ["push", "--quiet", remote.name, `${head}:refs/heads/${remote.remoteBranch}`],
    { network: true },
  );
  if (push.exitCode !== 0) {
    return {
      status: "failed",
      message: firstLine(push.stderr) || "Could not send your notes to the backup.",
    } as SyncResult;
  }
  return { status: "synced", pushed: true } as SyncResult;
});

/** How many saved changes have not reached the remote yet; null when that is unknown. */
export const countUnsent = Effect.fn("majordome.countUnsent")(function* (input: {
  readonly cwd: string;
  readonly remote: VaultRemote;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* git.execute({
    operation: "majordome.vaultUnsent",
    cwd: input.cwd,
    args: [
      "rev-list",
      "--count",
      `refs/remotes/${input.remote.name}/${input.remote.remoteBranch}..HEAD`,
    ],
    allowNonZeroExit: true,
  });
  return result.exitCode === 0 ? Number(result.stdout.trim()) : null;
});
