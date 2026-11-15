import type { EnvironmentId, MajordomeVaultHistoryEntry, ProjectId } from "@t3tools/contracts";

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
