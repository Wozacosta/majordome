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
}

const RUN_PREFIX = "majordome: ";
const UNDO_PREFIX = "Undo: ";
const REVERTS_LINE = /^Reverts ([0-9a-f]{7,64})\.$/m;

/** The title a person reads: the thread's name for a run, the subject for their own changes. */
export function feedItemTitle(entry: MajordomeVaultHistoryEntry): string {
  if (!entry.byMajordome) return entry.subject;
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
        at: Date.parse(entry.committedAt),
      });
    }
  }
  return items.toSorted((left, right) => right.at - left.at);
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
