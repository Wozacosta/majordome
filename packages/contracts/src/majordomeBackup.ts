import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MajordomeBackupInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeBackupInput = typeof MajordomeBackupInput.Type;

/**
 * Why saving or syncing stopped. `secret` and `unfinished-merge` stop saving the owner's edits;
 * `secret-not-sent` and `conflict` stop syncing only, so edits are still saved on this computer.
 */
export const MajordomeBackupPauseReason = Schema.Literals([
  "secret",
  "secret-not-sent",
  "conflict",
  "unfinished-merge",
]);
export type MajordomeBackupPauseReason = typeof MajordomeBackupPauseReason.Type;

export const MajordomeBackupPause = Schema.Struct({
  reason: MajordomeBackupPauseReason,
  files: Schema.Array(Schema.String),
  since: Schema.String,
});
export type MajordomeBackupPause = typeof MajordomeBackupPause.Type;

/** The git remote a vault syncs with, when it has one. */
export const MajordomeBackupRemote = Schema.Struct({
  name: Schema.String,
  /** The server's host name, or null when the remote is a folder on this computer. */
  host: Schema.NullOr(Schema.String),
  isGitHub: Schema.Boolean,
  /** A page a person can open, such as the GitHub repository; null when there is none. */
  webUrl: Schema.NullOr(Schema.String),
  syncing: Schema.Boolean,
  /** Synced, and nothing saved since is waiting to be sent. */
  backedUp: Schema.Boolean,
  lastSyncedAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});
export type MajordomeBackupRemote = typeof MajordomeBackupRemote.Type;

export const MajordomeBackupFolder = Schema.Struct({
  path: Schema.String,
  keep: Schema.Number,
  lastBackupAt: Schema.NullOr(Schema.String),
  lastFile: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});
export type MajordomeBackupFolder = typeof MajordomeBackupFolder.Type;

/** Why the last Google Drive backup failed, when the person has something to do about it. */
export const MajordomeGoogleDriveProblem = Schema.Literals([
  "signed-out",
  "access-removed",
  "quota-full",
  "failed",
]);
export type MajordomeGoogleDriveProblem = typeof MajordomeGoogleDriveProblem.Type;

export const MajordomeBackupDrive = Schema.Struct({
  lastBackupAt: Schema.NullOr(Schema.String),
  lastFile: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(MajordomeGoogleDriveProblem),
});
export type MajordomeBackupDrive = typeof MajordomeBackupDrive.Type;

export const MajordomeBackupStatus = Schema.Struct({
  isVault: Schema.Boolean,
  lastSavedAt: Schema.NullOr(Schema.String),
  saveError: Schema.NullOr(Schema.String),
  paused: Schema.NullOr(MajordomeBackupPause),
  remote: Schema.NullOr(MajordomeBackupRemote),
  folder: Schema.NullOr(MajordomeBackupFolder),
  /** The nightly copy to Google Drive, when this vault has one. */
  drive: Schema.NullOr(MajordomeBackupDrive),
  /** Whether this vault has an encryption passphrase for its folder and Drive copies. */
  hasPassphrase: Schema.Boolean,
  googleDrive: Schema.Struct({ available: Schema.Boolean, signedIn: Schema.Boolean }),
  github: Schema.Struct({
    /** False until the server is given the Majordome GitHub app's client id. */
    available: Schema.Boolean,
    signedIn: Schema.Boolean,
  }),
  /** Whether the secret scan (gitleaks) is installed on this server. */
  secretScan: Schema.Boolean,
});
export type MajordomeBackupStatus = typeof MajordomeBackupStatus.Type;

export const MajordomeBackupChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("set-folder"),
    path: TrimmedNonEmptyString,
    passphrase: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("remove-folder") }),
  Schema.Struct({ type: Schema.Literal("set-syncing"), enabled: Schema.Boolean }),
  /** Forgets this server's GitHub sign-in. The vault's remote stays. */
  Schema.Struct({ type: Schema.Literal("disconnect-github") }),
  /** The passphrase for the encrypted copies, before connecting Google Drive without a folder. */
  Schema.Struct({ type: Schema.Literal("set-passphrase"), passphrase: Schema.String }),
  /** Stops the Drive copies, revokes this server's Google sign-in and forgets it. */
  Schema.Struct({ type: Schema.Literal("disconnect-google-drive") }),
]);
export type MajordomeBackupChange = typeof MajordomeBackupChange.Type;

export const MajordomeConfigureBackupInput = Schema.Struct({
  projectId: ProjectId,
  change: MajordomeBackupChange,
});
export type MajordomeConfigureBackupInput = typeof MajordomeConfigureBackupInput.Type;

export const MajordomeGitHubConnectPrompt = Schema.Union([
  /** This server already holds a GitHub sign-in; waiting creates the repository. */
  Schema.Struct({ status: Schema.Literal("signed-in") }),
  Schema.Struct({
    status: Schema.Literal("code"),
    userCode: Schema.String,
    verificationUri: Schema.String,
    expiresAt: Schema.Number,
  }),
]);
export type MajordomeGitHubConnectPrompt = typeof MajordomeGitHubConnectPrompt.Type;

/** Google's device sign-in has the same shape: a code to enter on a page. */
export const MajordomeGoogleDriveConnectPrompt = MajordomeGitHubConnectPrompt;
export type MajordomeGoogleDriveConnectPrompt = MajordomeGitHubConnectPrompt;

/** The vault's name in its folder-backup file names, `majordome-<slug>-<YYYY-MM-DD>.age`. */
export function majordomeVaultSlug(folderName: string): string {
  return (
    folderName
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "vault"
  );
}
