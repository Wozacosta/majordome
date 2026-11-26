import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, isListedThreadLineage, type ThreadId } from "@t3tools/contracts";

import { resolveThreadStatusPill } from "../Sidebar.logic";
import { chatStatusWords, chatTitle } from "./chats.logic";
import { buildFeedRunItems, FEED_RUN_STATUS_LABELS, type FeedVault } from "./feed.logic";
import type { MajordomeVault } from "./topics.logic";
import { isUnreadChat } from "./unread.logic";

type InFlightThread = Parameters<typeof buildFeedRunItems>[0][number] &
  Parameters<typeof resolveThreadStatusPill>[0]["thread"] & {
    readonly settledOverride: "settled" | "active" | null;
  };

/** The mark at the start of a row. */
export type InFlightMark = "asking" | "failed" | "answered" | "working";

export interface InFlightRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  /** The topic the chat is listed under, or what kind of chat it is; null for a plain chat. */
  readonly place: string | null;
  readonly mark: InFlightMark;
  /** The state in the words the chat lists use. */
  readonly state: string;
  /** The sidebar's card counts this one among the things that need the owner. */
  readonly alerted: boolean;
}

export interface InFlight {
  readonly needsYou: ReadonlyArray<InFlightRow>;
  readonly working: ReadonlyArray<InFlightRow>;
}

/** How a chat with its own place is named on a row. */
export interface InFlightPlace {
  readonly title?: string;
  readonly place: string | null;
  /** A routine's own chat: what it did is under "Lately in your notes", so a reply is not news. */
  readonly routine?: boolean;
}

/**
 * Where the notes folder's chats belong, by `scopedThreadKey`: a topic's own conversation carries
 * the topic's name, a chat listed under a topic names that topic, and a routine's chat says so.
 */
export function inFlightPlaces(
  vault: Pick<MajordomeVault, "topics">,
  routineKeys: ReadonlySet<string>,
): ReadonlyMap<string, InFlightPlace> {
  const places = new Map<string, InFlightPlace>();
  for (const key of routineKeys) places.set(key, { place: "Routine", routine: true });
  for (const topic of vault.topics) {
    for (const chat of [...(topic.otherChats ?? []), ...(topic.sideChats ?? [])]) {
      places.set(scopedThreadKey(chat), { place: topic.title });
    }
    if (topic.threadId !== null) {
      places.set(
        scopedThreadKey({ environmentId: topic.threadEnvironmentId, threadId: topic.threadId }),
        { title: topic.title, place: null },
      );
    }
  }
  return places;
}

const NEEDS_YOU_WORDS: Readonly<Record<string, InFlightMark>> = {
  "Pending Approval": "asking",
  "Awaiting Input": "asking",
  "Guest Request": "asking",
  "Plan Ready": "asking",
  Failed: "failed",
  Completed: "answered",
};

const startedAt = (thread: InFlightThread) =>
  thread.latestRun?.startedAt ?? thread.latestRun?.requestedAt ?? thread.updatedAt;

/**
 * The notes folder's chats that are going on, in the two groups Today shows. "Needs you" starts
 * with exactly the runs the sidebar's card counts (`buildFeedRunItems`), then the chats with a
 * reply, a plan or a guest's message the owner has not opened; a routine's finished run is left to
 * "Lately in your notes". "Working" is every chat with a turn running, a routine's included.
 */
export function selectInFlight(input: {
  readonly threads: ReadonlyArray<InFlightThread>;
  /** Each server's copy of the notes folder. */
  readonly vaults: ReadonlyArray<FeedVault>;
  /** `stoppedRunKeys`: runs the time limit stopped. */
  readonly stoppedRuns?: ReadonlySet<string>;
  readonly places?: ReadonlyMap<string, InFlightPlace>;
}): InFlight {
  const { threads, vaults, places = new Map<string, InFlightPlace>() } = input;
  const row = (
    thread: Pick<InFlightThread, "environmentId" | "id" | "title">,
    rest: Pick<InFlightRow, "mark" | "state" | "alerted">,
  ): InFlightRow => {
    const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    const named = places.get(key);
    return {
      key,
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: named?.title ?? chatTitle(thread.title),
      place: named?.place ?? null,
      ...rest,
    };
  };
  const byKey = new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]));
  const needsYou: Array<InFlightRow> = [];
  const alerted = new Set<string>();
  for (const run of buildFeedRunItems(threads, vaults, input.stoppedRuns)) {
    const thread = byKey.get(run.key);
    if (thread === undefined) continue;
    alerted.add(run.key);
    const pill = run.status === "waiting" ? resolveThreadStatusPill({ thread }) : null;
    needsYou.push(
      row(thread, {
        mark: run.status === "waiting" ? "asking" : "failed",
        state:
          pill !== null && NEEDS_YOU_WORDS[pill.label] === "asking"
            ? chatStatusWords(pill.label)
            : FEED_RUN_STATUS_LABELS[run.status],
        // The card is not told which runs the time limit stopped.
        alerted: run.status !== "stopped",
      }),
    );
  }

  const inVault = new Set(vaults.map((vault) => `${vault.environmentId}:${vault.projectId}`));
  const unread: Array<InFlightRow & { readonly at: string }> = [];
  const working: Array<InFlightRow & { readonly at: string }> = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    if (!inVault.has(`${thread.environmentId}:${thread.projectId}`)) continue;
    if (alerted.has(`${thread.environmentId}:${thread.id}`)) continue;
    const pill = resolveThreadStatusPill({ thread });
    if (pill === null) continue;
    const mark = NEEDS_YOU_WORDS[pill.label];
    if (mark === undefined) {
      working.push({
        ...row(thread, {
          mark: "working",
          // Held by a chat it started or by work left running: still the assistant's turn.
          state:
            pill.label === "Waiting" ? "Working in the background" : chatStatusWords(pill.label),
          alerted: false,
        }),
        at: startedAt(thread),
      });
      continue;
    }
    if (mark === "answered" && !isUnreadChat(thread, places)) continue;
    unread.push({
      ...row(thread, { mark, state: chatStatusWords(pill.label), alerted: false }),
      at: thread.latestRun?.completedAt ?? thread.updatedAt,
    });
  }
  const newestFirst = (left: { readonly at: string; readonly key: string }, right: typeof left) =>
    Date.parse(right.at) - Date.parse(left.at) || left.key.localeCompare(right.key);
  const plain = ({ at: _at, ...rest }: InFlightRow & { readonly at: string }): InFlightRow => rest;
  return {
    needsYou: [...needsYou, ...unread.toSorted(newestFirst).map(plain)],
    working: working.toSorted(newestFirst).map(plain),
  };
}

/** How many rows a group shows before "+N more". */
const IN_FLIGHT_SHOWN = 3;

/** A group's rows as shown: the first few, and how many are left behind "+N more". */
export function capInFlight<T>(
  rows: ReadonlyArray<T>,
  expanded: boolean,
): { readonly shown: ReadonlyArray<T>; readonly more: number } {
  if (expanded || rows.length <= IN_FLIGHT_SHOWN) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, IN_FLIGHT_SHOWN), more: rows.length - IN_FLIGHT_SHOWN };
}
