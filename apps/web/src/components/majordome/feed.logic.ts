import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type EnvironmentId,
  isListedThreadLineage,
  type MajordomeVaultHistoryEntry,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

import { resolveSidebarRowStatus } from "../Sidebar.logic";

export interface FeedVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
}

export interface FeedItem {
  readonly key: string;
  readonly vault: FeedVault;
  readonly entry: MajordomeVaultHistoryEntry;
  readonly title: string;
  /** A later "Undo" already reverted this change. */
  readonly undone: boolean;
  /** Set when this is one of the owner's saves ("Your edits"), with the computer it came from. */
  readonly ownerEdit: OwnerEdit | null;
}

export interface OwnerEdit {
  readonly host: string | null;
}

/** The owner's back-to-back saves on one day, with no other change to that vault in between. */
export interface FeedEditGroup {
  readonly kind: "edits";
  readonly key: string;
  readonly vault: FeedVault;
  /** Newest first. */
  readonly saves: ReadonlyArray<FeedItem>;
  /** Every note the saves changed, newest first, once each. */
  readonly files: ReadonlyArray<string>;
  readonly hosts: ReadonlyArray<string>;
}

export type FeedListItem =
  | { readonly kind: "change"; readonly key: string; readonly item: FeedItem }
  | FeedEditGroup;

const RUN_PREFIX = "majordome: ";
const UNDO_PREFIX = "Undo: ";
const REVERTS_LINE = /^Reverts ([0-9a-f]{7,64})\.$/m;
const YOUR_EDITS_SUBJECT = "Your edits";
// What the owner's sync script wrote before Majordome saved their edits: "sync(mac): 1 files".
const SYNC_SUBJECT = /^sync\(([^)]*)\): \d+ files?$/;

/** Whether the owner's change is one of their saves, and which computer it came from. */
export function feedOwnerEdit(entry: MajordomeVaultHistoryEntry): OwnerEdit | null {
  if (entry.byMajordome) return null;
  if (entry.subject === YOUR_EDITS_SUBJECT) return { host: null };
  const host = SYNC_SUBJECT.exec(entry.subject)?.[1]?.trim();
  if (host === undefined) return null;
  return { host: host === "" ? null : host };
}

/** The title a person reads: the thread's name for a run, the subject for their own changes. */
export function feedItemTitle(entry: MajordomeVaultHistoryEntry): string {
  if (!entry.byMajordome) {
    return feedOwnerEdit(entry) === null ? entry.subject : YOUR_EDITS_SUBJECT;
  }
  if (entry.subject.startsWith(UNDO_PREFIX)) {
    const undone = entry.subject.slice(UNDO_PREFIX.length);
    return `Undid “${undone.startsWith(RUN_PREFIX) ? undone.slice(RUN_PREFIX.length) : undone}”`;
  }
  return entry.subject.startsWith(RUN_PREFIX)
    ? entry.subject.slice(RUN_PREFIX.length)
    : entry.subject;
}

/** Every vault's changes in one list, newest first. */
export function buildFeedItems(
  histories: ReadonlyArray<{
    readonly vault: FeedVault;
    readonly entries: ReadonlyArray<MajordomeVaultHistoryEntry>;
  }>,
  options: { readonly includeOwnChanges: boolean },
): ReadonlyArray<FeedItem> {
  const items: Array<FeedItem & { readonly at: number }> = [];
  for (const { vault, entries } of histories) {
    const undoneCommits = new Set<string>();
    for (const entry of entries) {
      const reverted = entry.byMajordome ? REVERTS_LINE.exec(entry.body)?.[1] : undefined;
      if (reverted !== undefined) undoneCommits.add(reverted);
    }
    for (const entry of entries) {
      if (!entry.byMajordome && !options.includeOwnChanges) continue;
      items.push({
        key: `${vault.environmentId}:${vault.projectId}:${entry.commit}`,
        vault,
        entry,
        title: feedItemTitle(entry),
        undone: undoneCommits.has(entry.commit),
        ownerEdit: feedOwnerEdit(entry),
        at: Date.parse(entry.committedAt),
      });
    }
  }
  return items.toSorted((left, right) => right.at - left.at);
}

function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Folds the owner's back-to-back saves to one vault on one day into a single row. Any other change
 * to that vault (a run, an undo, a commit of their own) ends the group; other vaults' changes do
 * not. A lone save stays a plain row.
 */
export function groupFeedItems(items: ReadonlyArray<FeedItem>): ReadonlyArray<FeedListItem> {
  const slots: Array<FeedItem | Array<FeedItem>> = [];
  const open = new Map<string, { readonly day: string; readonly saves: Array<FeedItem> }>();
  for (const item of items) {
    const vaultKey = `${item.vault.environmentId}:${item.vault.projectId}`;
    if (item.ownerEdit === null) {
      open.delete(vaultKey);
      slots.push(item);
      continue;
    }
    const day = localDay(item.entry.committedAt);
    const current = open.get(vaultKey);
    if (current !== undefined && current.day === day) {
      current.saves.push(item);
      continue;
    }
    const saves = [item];
    open.set(vaultKey, { day, saves });
    slots.push(saves);
  }
  return slots.map((slot): FeedListItem => {
    if (!Array.isArray(slot)) return { kind: "change", key: slot.key, item: slot };
    const [first, ...rest] = slot as [FeedItem, ...Array<FeedItem>];
    if (rest.length === 0) return { kind: "change", key: first.key, item: first };
    return {
      kind: "edits",
      key: `edits:${first.key}`,
      vault: first.vault,
      saves: slot,
      files: [...new Set(slot.flatMap((save) => save.entry.files))],
      hosts: [...new Set(slot.flatMap((save) => save.ownerEdit?.host ?? []))],
    };
  });
}

/** The first few notes a change touched, and how many more there were. */
export function summarizeFeedFiles(
  files: ReadonlyArray<string>,
  max = 4,
): { readonly shown: ReadonlyArray<string>; readonly more: number } {
  return { shown: files.slice(0, max), more: Math.max(0, files.length - max) };
}

/** A run that needs the person: it waits on their answer, or it stopped before finishing. */
export type FeedRunStatus = "waiting" | "failed";

export const FEED_RUN_STATUS_LABELS: Record<FeedRunStatus, string> = {
  waiting: "Waiting for you",
  failed: "Couldn't finish",
};

export interface FeedRunItem {
  readonly key: string;
  readonly vault: FeedVault;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: FeedRunStatus;
  readonly at: string;
}

type FeedRunThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
  | "lineage"
  | "archivedAt"
  | "updatedAt"
  | "pendingUserInputAt"
  | "latestRun"
  | "runtime"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "blockedOnThreadWait"
  | "lastVisitedAt"
>;

/**
 * The feed's word for a thread's state, read the way the sidebar reads it: a pending approval or
 * question is "waiting", and a failure (usage limits included) is "failed" until the person opens
 * the chat. Anything else is not the feed's to flag.
 */
function feedRunStatus(thread: FeedRunThread): FeedRunStatus | null {
  switch (resolveSidebarRowStatus(thread)) {
    case "approval":
    case "input":
      return "waiting";
    case "failed":
    case "limited":
      return "failed";
    default:
      return null;
  }
}

function feedRunAt(thread: FeedRunThread, status: FeedRunStatus): string {
  const run = thread.latestRun;
  return status === "failed"
    ? (run?.completedAt ?? thread.runtime?.updatedAt ?? thread.updatedAt)
    : (thread.pendingUserInputAt ?? run?.startedAt ?? run?.requestedAt ?? thread.updatedAt);
}

/**
 * Runs that need the person, one per thread, newest first. The feed shows them above its list of
 * changes. A change row is what a run saved, never how the run went, so the two never say the same
 * thing: a run that failed after saving notes shows both, the failure here and its change below
 * with "Undo this".
 */
export function buildFeedRunItems(
  threads: ReadonlyArray<FeedRunThread>,
  vaults: ReadonlyArray<FeedVault>,
): ReadonlyArray<FeedRunItem> {
  const vaultByProject = new Map(
    vaults.map((vault) => [`${vault.environmentId}:${vault.projectId}`, vault] as const),
  );
  const items: Array<FeedRunItem & { readonly atMs: number }> = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    const vault = vaultByProject.get(`${thread.environmentId}:${thread.projectId}`);
    if (vault === undefined) continue;
    const status = feedRunStatus(thread);
    if (status === null) continue;
    const at = feedRunAt(thread, status);
    items.push({
      key: `${thread.environmentId}:${thread.id}`,
      vault,
      threadId: thread.id,
      title: thread.title,
      status,
      at,
      atMs: Date.parse(at),
    });
  }
  return items
    .toSorted((left, right) => right.atMs - left.atMs || left.key.localeCompare(right.key))
    .map(({ atMs: _atMs, ...item }) => item);
}
