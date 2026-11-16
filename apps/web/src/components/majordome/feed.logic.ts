import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type EnvironmentId,
  isListedThreadLineage,
  type MajordomeRoutinesStatus,
  type MajordomeVaultHistoryEntry,
  type ProjectId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";

import { resolveSidebarRowStatus } from "../Sidebar.logic";
import { machineInSentence } from "./brains.logic";

export interface FeedVault {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  /** `brainKey` of the brain this copy is; without one, the copy is its own brain. */
  readonly brainKey?: string;
  /** The server's name, set when the brain is on several servers. */
  readonly machine?: string | null;
}

/** One key for every copy of a brain. */
function feedBrainKey(vault: FeedVault): string {
  return vault.brainKey ?? `${vault.environmentId}:${vault.projectId}`;
}

/**
 * What to tell the owner when a brain's routines can't run on the server that runs them; null when
 * they can, or when the server is too old to say. `machine` is that server as `machineName` has it.
 */
export function routinesBlockedLine(
  status: MajordomeRoutinesStatus | undefined,
  machine: string,
): { readonly text: string; readonly tone: "warning" | "neutral" } | null {
  if (status === undefined || status.ready) return null;
  const where = `on ${machineInSentence(machine)}`;
  const provider = status.provider ?? "the AI they use";
  switch (status.reason) {
    case "not-created":
      // A provider is ready, so the server makes them at its next check.
      return { text: `Routines are being set up ${where}.`, tone: "neutral" };
    case "provider-signed-out":
      return { text: `Routines can't run: ${provider} is signed out ${where}.`, tone: "warning" };
    case "provider-unavailable":
      return { text: `Routines can't run: ${provider} isn't available ${where}.`, tone: "warning" };
    default:
      return { text: `Routines can't run: no AI is signed in ${where}.`, tone: "warning" };
  }
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
  /** The server a run happened on, when its brain is on several and that server has its chat. */
  readonly machine: string | null;
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

/**
 * Every brain's changes in one list, newest first. Copies of one brain share their history, so a
 * change appears once: from the server that has the run's chat, else from the first copy given.
 */
export function buildFeedItems(
  histories: ReadonlyArray<{
    readonly vault: FeedVault;
    readonly entries: ReadonlyArray<MajordomeVaultHistoryEntry>;
  }>,
  options: {
    readonly includeOwnChanges: boolean;
    /** `${environmentId}:${threadId}` of the chats each server has. */
    readonly knownThreads?: ReadonlySet<string>;
  },
): ReadonlyArray<FeedItem> {
  const undoneCommits = new Set<string>();
  for (const { vault, entries } of histories) {
    for (const entry of entries) {
      const reverted = entry.byMajordome ? REVERTS_LINE.exec(entry.body)?.[1] : undefined;
      if (reverted !== undefined) undoneCommits.add(`${feedBrainKey(vault)}:${reverted}`);
    }
  }
  const items = new Map<string, FeedItem & { readonly at: number; readonly ranHere: boolean }>();
  for (const { vault, entries } of histories) {
    for (const entry of entries) {
      if (!entry.byMajordome && !options.includeOwnChanges) continue;
      const key = `${feedBrainKey(vault)}:${entry.commit}`;
      const ranHere =
        entry.threadId !== null &&
        (entry.summary != null ||
          options.knownThreads?.has(`${vault.environmentId}:${entry.threadId}`) === true);
      const seen = items.get(key);
      if (seen !== undefined && (seen.ranHere || !ranHere)) continue;
      items.set(key, {
        key,
        vault,
        entry,
        title: feedItemTitle(entry),
        undone: undoneCommits.has(key),
        ownerEdit: feedOwnerEdit(entry),
        machine: ranHere ? (vault.machine ?? null) : null,
        at: Date.parse(entry.committedAt),
        ranHere,
      });
    }
  }
  return [...items.values()]
    .toSorted((left, right) => right.at - left.at)
    .map(({ at: _at, ranHere: _ranHere, ...item }) => item);
}

function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Folds the owner's back-to-back saves to one brain on one day into a single row. Any other change
 * to that brain (a run, an undo, a commit of their own) ends the group; other brains' changes do
 * not. A lone save stays a plain row.
 */
export function groupFeedItems(items: ReadonlyArray<FeedItem>): ReadonlyArray<FeedListItem> {
  const slots: Array<FeedItem | Array<FeedItem>> = [];
  const open = new Map<string, { readonly day: string; readonly saves: Array<FeedItem> }>();
  for (const item of items) {
    const vaultKey = feedBrainKey(item.vault);
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

/**
 * A run that needs the person: it waits on their answer, it stopped before finishing, or the time
 * limit for routines stopped it.
 */
export type FeedRunStatus = "waiting" | "failed" | "stopped";

export const FEED_RUN_STATUS_LABELS: Record<FeedRunStatus, string> = {
  waiting: "Waiting for you",
  failed: "Couldn't finish",
  stopped: "Stopped: ran too long",
};

export interface FeedRunItem {
  readonly key: string;
  readonly vault: FeedVault;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: FeedRunStatus;
  readonly at: string;
  /** The card only the owner can answer that the run waits on, such as a private document request. */
  readonly ownerCardId: TurnItemId | null;
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
> & { readonly source?: Pick<EnvironmentThreadShell["source"], "pendingRuntimeRequest"> };

/** `${environmentId}:${runId}` of each run the time limit stopped, from the vault histories. */
export function stoppedRunKeys(
  vaults: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly stoppedRuns: ReadonlyArray<{ readonly runId: string }>;
  }>,
): ReadonlySet<string> {
  return new Set(
    vaults.flatMap((vault) =>
      vault.stoppedRuns.map((run) => `${vault.environmentId}:${run.runId}`),
    ),
  );
}

/** The thread's latest run was stopped by the time limit, after the person last opened it. */
function wasStoppedUnseen(thread: FeedRunThread, stoppedRuns: ReadonlySet<string>): boolean {
  const run = thread.latestRun;
  if (run?.status !== "interrupted" || !stoppedRuns.has(`${thread.environmentId}:${run.runId}`)) {
    return false;
  }
  if (!thread.lastVisitedAt || !run.completedAt) return true;
  return Date.parse(run.completedAt) > Date.parse(thread.lastVisitedAt);
}

/**
 * The feed's word for a thread's state, read the way the sidebar reads it: a pending approval or
 * question is "waiting", and a failure (usage limits included) is "failed" until the person opens
 * the chat, as is a run the time limit stopped. Anything else is not the feed's to flag.
 */
function feedRunStatus(
  thread: FeedRunThread,
  stoppedRuns: ReadonlySet<string>,
): FeedRunStatus | null {
  if (wasStoppedUnseen(thread, stoppedRuns)) return "stopped";
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

/** A waiting card's id is its turn item's; `userOnly` tells it from a provider's own question. */
function ownerCardId(thread: FeedRunThread): TurnItemId | null {
  const request = thread.source?.pendingRuntimeRequest;
  return request?.userOnly === true ? TurnItemId.make(request.id) : null;
}

function feedRunAt(thread: FeedRunThread, status: FeedRunStatus): string {
  const run = thread.latestRun;
  return status !== "waiting"
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
  stoppedRuns: ReadonlySet<string> = new Set(),
): ReadonlyArray<FeedRunItem> {
  const vaultByProject = new Map(
    vaults.map((vault) => [`${vault.environmentId}:${vault.projectId}`, vault] as const),
  );
  const items: Array<FeedRunItem & { readonly atMs: number }> = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    const vault = vaultByProject.get(`${thread.environmentId}:${thread.projectId}`);
    if (vault === undefined) continue;
    const status = feedRunStatus(thread, stoppedRuns);
    if (status === null) continue;
    const at = feedRunAt(thread, status);
    items.push({
      key: `${thread.environmentId}:${thread.id}`,
      vault,
      threadId: thread.id,
      title: thread.title,
      status,
      at,
      ownerCardId: status === "waiting" ? ownerCardId(thread) : null,
      atMs: Date.parse(at),
    });
  }
  return items
    .toSorted((left, right) => right.atMs - left.atMs || left.key.localeCompare(right.key))
    .map(({ atMs: _atMs, ...item }) => item);
}

/** What a change is, for the person reading the feed. */
export type FeedEntryKind = "run" | "undo" | "own-edit" | "own-change";

export function classifyFeedEntry(entry: MajordomeVaultHistoryEntry): FeedEntryKind {
  if (!entry.byMajordome) return feedOwnerEdit(entry) === null ? "own-change" : "own-edit";
  return entry.subject.startsWith(UNDO_PREFIX) ? "undo" : "run";
}

/** What the vault said about its notes: its daily and inbox folders, and the notes' headings. */
export interface FeedVaultNotes {
  readonly dailyFolder: string;
  readonly inboxFolder: string;
  /** Notes that still exist, with their first heading or null. */
  readonly notes: Readonly<Record<string, string | null>>;
}

export function feedVaultNotes(history: {
  readonly folders?: { readonly daily: string; readonly inbox: string } | undefined;
  readonly notes?: Readonly<Record<string, string | null>> | undefined;
}): FeedVaultNotes {
  return {
    dailyFolder: history.folders?.daily ?? "daily",
    inboxFolder: history.folders?.inbox ?? "inbox",
    notes: history.notes ?? {},
  };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayWithYearFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", "Tue 3 Nov", or "3 Nov 2025" for another year. */
function feedDayLabel(day: Date, nowMs: number): string {
  const days = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(day.getTime())) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.getFullYear() === new Date(nowMs).getFullYear()
    ? dayFormatter.format(day)
    : dayWithYearFormatter.format(day);
}

function baseName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function withSlash(folder: string): string {
  return `${folder.replace(/\/+$/, "")}/`;
}

/** A file or folder name as words: "handover-2026-11-03" reads "handover 2026-11-03". */
function plainName(name: string): string {
  return name
    .replaceAll("_", " ")
    .replaceAll(/(?<!\d)-|-(?!\d)/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** A note as a person names it: a daily note's day, its first heading, or its file name. */
export function feedNoteTitle(path: string, vaultNotes: FeedVaultNotes, nowMs: number): string {
  const dailyPrefix = withSlash(vaultNotes.dailyFolder);
  if (path.startsWith(dailyPrefix) && path.endsWith(".md")) {
    const match = ISO_DAY.exec(baseName(path));
    if (match !== null && !path.slice(dailyPrefix.length).includes("/")) {
      const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return feedDayLabel(day, nowMs);
    }
  }
  return vaultNotes.notes[path] ?? plainName(baseName(path));
}

export interface FeedNote {
  readonly path: string;
  readonly title: string;
  /** A Markdown note that is still there, so it can be opened. */
  readonly openable: boolean;
}

/** The notes a change touched, by title, notes that still exist first, and how many more. */
export function feedNotes(
  files: ReadonlyArray<string>,
  vaultNotes: FeedVaultNotes,
  nowMs: number,
  max = 4,
): { readonly shown: ReadonlyArray<FeedNote>; readonly more: number } {
  const notes = files
    .filter((file) => !file.startsWith(".majordome/"))
    .map((path) => ({
      path,
      title: feedNoteTitle(path, vaultNotes, nowMs),
      openable: Object.hasOwn(vaultNotes.notes, path),
    }))
    .toSorted((left, right) => Number(right.openable) - Number(left.openable));
  return { shown: notes.slice(0, max), more: Math.max(0, notes.length - max) };
}

function listWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "Filed 3 notes into Lisbon move and Reading": where "Digest my inbox" put the inbox's files. */
function feedFiledSummary(files: ReadonlyArray<string>, vaultNotes: FeedVaultNotes): string | null {
  const inbox = withSlash(vaultNotes.inboxFolder);
  const filed = files.filter((file) => !file.startsWith(inbox) && !file.startsWith(".majordome/"));
  if (filed.length === 0) return null;
  const folders = [
    ...new Set(
      filed.map((file) => {
        const parts = file.split("/");
        const folder = plainName(parts.at(-2) ?? "");
        return folder === "" ? "your notes" : folder[0]!.toUpperCase() + folder.slice(1);
      }),
    ),
  ];
  const shown =
    folders.length > 3 ? [...folders.slice(0, 2), `${folders.length - 2} more`] : folders;
  return `Filed ${filed.length} ${filed.length === 1 ? "note" : "notes"} into ${listWords(shown)}`;
}

/** The line under a run's name: what it did, in plain words. */
export function feedRunSummary(
  entry: MajordomeVaultHistoryEntry,
  vaultNotes: FeedVaultNotes,
): string | null {
  if (entry.routine === "digest-my-inbox") {
    const filed = feedFiledSummary(entry.files, vaultNotes);
    if (filed !== null) return filed;
  }
  return entry.summary ?? null;
}

/** The owner's own changes on one day, folded into one quiet line. */
export interface FeedOwnDay {
  readonly kind: "own-day";
  readonly key: string;
  /** The newest change that day, for its label. */
  readonly at: string;
  /** Newest first. */
  readonly items: ReadonlyArray<FeedItem>;
  /** Notes changed that day, each counted once. */
  readonly noteCount: number;
}

export type FeedTimelineItem =
  | { readonly kind: "change"; readonly key: string; readonly item: FeedItem }
  | FeedOwnDay;

/**
 * Keeps Majordome's changes as they are and folds the owner's own into one line per day, placed
 * where that day's newest one was.
 */
export function foldOwnChanges(items: ReadonlyArray<FeedItem>): ReadonlyArray<FeedTimelineItem> {
  const slots: Array<FeedItem | Array<FeedItem>> = [];
  const days = new Map<string, Array<FeedItem>>();
  for (const item of items) {
    if (item.entry.byMajordome) {
      slots.push(item);
      continue;
    }
    const day = localDay(item.entry.committedAt);
    const existing = days.get(day);
    if (existing !== undefined) {
      existing.push(item);
      continue;
    }
    const group = [item];
    days.set(day, group);
    slots.push(group);
  }
  return slots.map((slot): FeedTimelineItem => {
    if (!Array.isArray(slot)) return { kind: "change", key: slot.key, item: slot };
    const [first] = slot as [FeedItem, ...Array<FeedItem>];
    const notes = new Set(
      slot.flatMap((item) => item.entry.files.map((file) => `${feedBrainKey(item.vault)}:${file}`)),
    );
    return {
      kind: "own-day",
      key: `own:${first.key}`,
      at: first.entry.committedAt,
      items: slot,
      noteCount: notes.size,
    };
  });
}

/** "You edited 4 notes today", "… 1 note yesterday", "… 2 notes on Tue 3 Nov". */
export function ownDayLine(day: FeedOwnDay, nowMs: number): string {
  const label = feedDayLabel(new Date(day.at), nowMs);
  const when = label === "Today" ? "today" : label === "Yesterday" ? "yesterday" : `on ${label}`;
  return `You edited ${day.noteCount} ${day.noteCount === 1 ? "note" : "notes"} ${when}`;
}

/**
 * The feed's rows with the day each one starts: `day` is "Today", "Yesterday" or a date on the
 * first row of a day and null on the rest. `rows` are newest first.
 */
export function withDayHeadings<Row>(
  rows: ReadonlyArray<Row>,
  at: (row: Row) => string,
  nowMs: number,
): ReadonlyArray<{ readonly row: Row; readonly day: string | null }> {
  const days = rows.map((row) => localDay(at(row)));
  return rows.map((row, index) => ({
    row,
    day: days[index] === days[index - 1] ? null : feedDayLabel(new Date(at(row)), nowMs),
  }));
}
