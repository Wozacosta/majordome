import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MajordomeBackupInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeBackupInput = typeof MajordomeBackupInput.Type;

export const MajordomeBackUpNowInput = Schema.Struct({
  projectId: ProjectId,
  /** Only save and exchange notes with the owner's other machine: the quick part of a backup. */
  peerOnly: Schema.optional(Schema.Boolean),
});
export type MajordomeBackUpNowInput = typeof MajordomeBackUpNowInput.Type;

/**
 * Why saving or syncing stopped. `secret` and `unfinished-merge` stop saving the owner's edits;
 * `secret-not-sent` and `conflict` stop syncing only, so edits are still saved on this computer.
 * A note changed in two places keeps both versions (`otherVersions`); `conflict` is what is left
 * when that could not be done.
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
  /** Sent with the GitHub sign-in saved in Majordome; false when the computer's own keys send it. */
  usesSignIn: Schema.optional(Schema.Boolean),
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

/** Another of the owner's machines these notes are kept in step with, directly. */
export const MajordomeBackupPeer = Schema.Struct({
  /** The other machine's name. */
  label: Schema.String,
  environmentId: Schema.NullOr(Schema.String),
  /** True on the machine that holds the link and does the work; false on the one that answers. */
  linkedHere: Schema.Boolean,
  /** Both machines hold the same notes, as far as this one knows. */
  inStep: Schema.Boolean,
  lastInStepAt: Schema.NullOr(Schema.String),
  /** What is wrong, in plain words. */
  problem: Schema.NullOr(Schema.String),
  /** The other machine no longer accepts this one; the app links them again when it is open. */
  needsReconnect: Schema.Boolean,
});
export type MajordomeBackupPeer = typeof MajordomeBackupPeer.Type;

/** A folder a cloud service keeps on this computer, offered as a place for the backup. */
export const MajordomeBackupFolderSuggestion = Schema.Struct({
  label: Schema.String,
  path: Schema.String,
});
export type MajordomeBackupFolderSuggestion = typeof MajordomeBackupFolderSuggestion.Type;

export const MajordomeBackupStatus = Schema.Struct({
  isVault: Schema.Boolean,
  /**
   * Which brain this vault is: the root commit of its history, shared by every server's copy.
   * Null before the first commit; absent from older servers.
   */
  brainId: Schema.optional(Schema.NullOr(Schema.String)),
  lastSavedAt: Schema.NullOr(Schema.String),
  saveError: Schema.NullOr(Schema.String),
  paused: Schema.NullOr(MajordomeBackupPause),
  /**
   * Notes changed on two machines at once: `path` holds one version and `copy` the other, until
   * the owner removes or renames the copy. Absent from older servers.
   */
  otherVersions: Schema.optional(
    Schema.Array(Schema.Struct({ path: Schema.String, copy: Schema.String })),
  ),
  remote: Schema.NullOr(MajordomeBackupRemote),
  /** Absent from older servers; null when the notes are not kept in step with another machine. */
  peer: Schema.optional(Schema.NullOr(MajordomeBackupPeer)),
  folder: Schema.NullOr(MajordomeBackupFolder),
  /** Absent from older servers. */
  folderSuggestions: Schema.optional(Schema.Array(MajordomeBackupFolderSuggestion)),
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

/** Brings notes back from an encrypted folder copy, into a new folder that opens as the notes. */
export const MajordomeRestoreNotesInput = Schema.Struct({
  /** The backup file, or the folder that holds it; the newest copy in a folder is used. */
  source: TrimmedNonEmptyString,
  passphrase: Schema.String,
  /** The folder the new notes folder is made in; null means the home folder. */
  into: Schema.NullOr(TrimmedNonEmptyString),
});
export type MajordomeRestoreNotesInput = typeof MajordomeRestoreNotesInput.Type;

export const MajordomeRestoreNotesResult = Schema.Struct({
  projectId: ProjectId,
  /** The new folder the notes are in. */
  folder: Schema.String,
  /** The backup file that was opened. */
  file: Schema.String,
});
export type MajordomeRestoreNotesResult = typeof MajordomeRestoreNotesResult.Type;

export const MajordomeLinkPeerInput = Schema.Struct({
  projectId: ProjectId,
  /** The other machine's address. */
  url: TrimmedNonEmptyString,
  /** A one-time pairing credential made on the other machine. */
  credential: TrimmedNonEmptyString,
  /** The other machine's name, as the owner knows it. */
  label: TrimmedNonEmptyString,
});
export type MajordomeLinkPeerInput = typeof MajordomeLinkPeerInput.Type;

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
