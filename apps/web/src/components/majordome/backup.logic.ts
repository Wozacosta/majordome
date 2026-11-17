import {
  majordomeVaultSlug,
  type MajordomeBackupPauseReason,
  type MajordomeBackupStatus,
} from "@t3tools/contracts";

export type BackupTone = "ok" | "warning" | "neutral";

export interface BackupHeadline {
  readonly tone: BackupTone;
  readonly title: string;
  readonly detail: string | null;
}

const PAUSE_COPY: Record<MajordomeBackupPauseReason, { title: string; detail: string }> = {
  secret: {
    title: "A possible secret was found in your notes; saving is paused",
    detail:
      "Remove the password or key from these notes and keep it in your password manager. Saving starts again on its own.",
  },
  "secret-not-sent": {
    title: "A possible secret was found in your notes; syncing is paused",
    detail:
      "A saved change holds what looks like a password or key, so it stays on this computer. Your edits are still saved here.",
  },
  conflict: {
    title: "Your notes changed in two places; syncing is paused",
    detail:
      "These notes were changed here and somewhere else. Your edits are still saved on this computer; Majordome tries again every few minutes.",
  },
  "unfinished-merge": {
    title: "Saving is paused while your notes are mid-merge",
    detail: "Finish or cancel the merge in your notes folder, and saving starts again on its own.",
  },
};

/** Where a vault's remote lives, in plain words. */
function remoteLabel(remote: NonNullable<MajordomeBackupStatus["remote"]>): string {
  if (remote.isGitHub) return "GitHub";
  return remote.host ?? "another folder on this computer";
}

/** The one line that says whether this vault is safe, and what is wrong when it is not. */
export function backupHeadline(status: MajordomeBackupStatus): BackupHeadline {
  if (status.paused !== null) {
    const copy = PAUSE_COPY[status.paused.reason];
    return { tone: "warning", title: copy.title, detail: copy.detail };
  }
  const { remote, folder, drive } = status;
  if (remote !== null && remote.syncing && remote.backedUp) {
    return {
      tone: "ok",
      title: remote.isGitHub ? "Backed up to GitHub ✓" : `Backed up to ${remoteLabel(remote)} ✓`,
      detail: null,
    };
  }
  if (remote !== null && remote.syncing && remote.lastError !== null) {
    return {
      tone: "warning",
      title: `Couldn't back up to ${remoteLabel(remote)}`,
      // Trying again cannot fix a sign-in; only the person can.
      detail: /sign in/i.test(remote.lastError)
        ? remote.lastError
        : `${remote.lastError} Majordome tries again every few minutes.`,
    };
  }
  if (drive !== null && drive.lastError !== null) {
    return { tone: "warning", title: "Couldn't back up to Google Drive", detail: drive.lastError };
  }
  if (folder !== null && folder.lastError !== null) {
    return { tone: "warning", title: "Couldn't back up to your folder", detail: folder.lastError };
  }
  if (drive !== null && drive.lastBackupAt !== null) {
    return { tone: "ok", title: "Backed up to Google Drive ✓", detail: null };
  }
  if (folder !== null && folder.lastBackupAt !== null) {
    return { tone: "ok", title: "Backed up to your folder every night ✓", detail: null };
  }
  if (remote !== null && remote.syncing) {
    return {
      tone: "neutral",
      title: `Backing up to ${remoteLabel(remote)}`,
      detail: "Your latest changes are on their way.",
    };
  }
  return {
    tone: "warning",
    title: "Not backed up yet",
    detail: "Your notes and their history are only on this computer.",
  };
}

/**
 * The sidebar's short alert when saving or a chosen backup is paused or failing, or a note waits
 * in two versions, else null.
 * "Not backed up yet" alone does not count: it is a choice still to make, and a mark that never
 * goes away teaches people to ignore it.
 */
export function backupAttention(status: MajordomeBackupStatus): string | null {
  if (status.paused !== null) return "Backup paused";
  if (status.saveError !== null) return "Saving isn't working";
  const chosen = status.remote?.syncing === true || status.folder !== null || status.drive !== null;
  if (chosen && backupHeadline(status).tone === "warning") return "Backup isn't working";
  // Nothing is wrong or lost, but only the owner can say which version of a note is the one.
  const kept = status.otherVersions ?? [];
  return kept.length > 0 ? twoVersionsTitle(kept) : null;
}

export function twoVersionsTitle(kept: ReadonlyArray<unknown>): string {
  return kept.length === 1 ? "Two versions of a note" : `Two versions of ${kept.length} notes`;
}

const MIN_PASSPHRASE_LENGTH = 8;

/** Why the folder or passphrase form can't go on yet, or null when it can. */
export function folderFormProblem(input: {
  /** Null when the form only asks for a passphrase. */
  readonly path: string | null;
  readonly passphrase: string;
  readonly confirmation: string;
}): string | null {
  if (input.path !== null && input.path.trim() === "") return "Choose a folder.";
  if (input.passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters; a few unrelated words work well.`;
  }
  if (input.passphrase !== input.confirmation) return "The two passphrases don't match.";
  return null;
}

export function restoreCommands(vaultFolderName: string): ReadonlyArray<string> {
  const file = `majordome-${majordomeVaultSlug(vaultFolderName)}-YYYY-MM-DD.age`;
  return [`age -d -o brain.bundle ${file}`, "git clone brain.bundle my-notes"];
}
