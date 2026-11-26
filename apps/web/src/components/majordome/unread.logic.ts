import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, isListedThreadLineage, type ThreadId } from "@t3tools/contracts";

import { resolveThreadStatusPill } from "../Sidebar.logic";
import { chatTitle } from "./chats.logic";
import type { FeedVault } from "./feed.logic";
import type { InFlightPlace } from "./inFlight.logic";

type UnreadThread = Parameters<typeof resolveThreadStatusPill>[0]["thread"] & {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly lineage: Parameters<typeof isListedThreadLineage>[0];
  readonly settledOverride: "settled" | "active" | null;
};

/** The word upstream's `resolveThreadStatusPill` gives a chat whose reply has not been opened. */
const UNREAD_PILL = "Completed";

/**
 * Whether a chat holds a reply the owner has not read. This is the one meaning of unread: the
 * chat lists' "New reply", the Unread group and its count, and Today's answered rows all ask it.
 * A chat marked as done has been dealt with, and a routine's reply is not news.
 */
export function isUnreadChat(
  thread: Parameters<typeof resolveThreadStatusPill>[0]["thread"] &
    Pick<UnreadThread, "environmentId" | "id" | "settledOverride">,
  places: ReadonlyMap<string, InFlightPlace>,
): boolean {
  if (resolveThreadStatusPill({ thread })?.label !== UNREAD_PILL) return false;
  if (thread.settledOverride === "settled") return false;
  const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
  return places.get(key)?.routine !== true;
}

export interface UnreadChat<T> {
  readonly key: string;
  readonly thread: T;
  readonly title: string;
  /** The topic the chat is listed under; null for a plain chat or a topic's own conversation. */
  readonly place: string | null;
  /** When the unread reply came. */
  readonly at: string;
}

/** The notes folder's chats with a reply the owner has not read, on every server, newest first. */
export function selectUnreadChats<T extends UnreadThread>(input: {
  readonly threads: ReadonlyArray<T>;
  /** Each server's copy of the notes folder. */
  readonly vaults: ReadonlyArray<Pick<FeedVault, "environmentId" | "projectId">>;
  readonly places?: ReadonlyMap<string, InFlightPlace>;
}): ReadonlyArray<UnreadChat<T>> {
  const { threads, vaults, places = new Map<string, InFlightPlace>() } = input;
  const inVault = new Set(vaults.map((vault) => `${vault.environmentId}:${vault.projectId}`));
  return threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        isListedThreadLineage(thread.lineage) &&
        inVault.has(`${thread.environmentId}:${thread.projectId}`) &&
        isUnreadChat(thread, places),
    )
    .map((thread) => {
      const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
      const named = places.get(key);
      return {
        key,
        thread,
        title: named?.title ?? chatTitle(thread.title),
        place: named?.place ?? null,
        at: thread.latestRun?.completedAt ?? thread.updatedAt,
      };
    })
    .toSorted(
      (left, right) =>
        Date.parse(right.at) - Date.parse(left.at) || left.key.localeCompare(right.key),
    );
}

/** How many unread chats the sidebar lists before "+N more". */
const UNREAD_SHOWN = 5;

/** The sidebar's unread rows as shown: the first few, and how many are behind "+N more". */
export function capUnread<T>(
  rows: ReadonlyArray<T>,
  expanded: boolean,
): { readonly shown: ReadonlyArray<T>; readonly more: number } {
  if (expanded || rows.length <= UNREAD_SHOWN) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, UNREAD_SHOWN), more: rows.length - UNREAD_SHOWN };
}
