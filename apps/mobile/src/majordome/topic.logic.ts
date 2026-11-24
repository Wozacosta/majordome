import type { MajordomeTopicIcon } from "@t3tools/contracts";
import { topicIcon, topicTone, type TopicTone } from "@t3tools/shared/majordomeTopicIcons";

import { chatMatchesSearch } from "./chat.logic";
import type { TopicRow } from "./today.logic";

/** A topic marked as finished, as the Chats list offers to bring it back. */
export interface FinishedTopic {
  readonly id: string;
  readonly title: string;
  readonly threadId: string | null;
  readonly icon: MajordomeTopicIcon;
  readonly tone: TopicTone;
}

/** The finished topics, the one finished last first. */
export function finishedTopics(
  topics: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly folder: string;
    readonly icon?: MajordomeTopicIcon | undefined;
    readonly finishedAt?: string | undefined;
    readonly threadId: string | null;
  }>,
): ReadonlyArray<FinishedTopic> {
  return topics
    .flatMap((topic) => (topic.finishedAt === undefined ? [] : [{ topic, at: topic.finishedAt }]))
    .sort((left, right) => right.at.localeCompare(left.at))
    .map(({ topic }) => ({
      id: topic.id,
      title: topic.title,
      threadId: topic.threadId,
      icon: topicIcon(topic),
      tone: topicTone(topic),
    }));
}

/**
 * Where each topic shows in the Chats list. One whose conversation is among the listed chats is
 * drawn on that chat's row (`byThread`, keyed by thread id), so it moves with its latest message.
 * The others have no row of their own yet and are listed `apart`, above the chats; a search keeps
 * only those whose name or latest line matches.
 */
export function placeTopics(
  topics: ReadonlyArray<TopicRow>,
  listedThreadIds: ReadonlySet<string>,
  query: string,
): { readonly byThread: ReadonlyMap<string, TopicRow>; readonly apart: ReadonlyArray<TopicRow> } {
  const byThread = new Map<string, TopicRow>();
  const apart: Array<TopicRow> = [];
  for (const topic of topics) {
    if (topic.threadId !== null && listedThreadIds.has(topic.threadId)) {
      byThread.set(topic.threadId, topic);
    } else if (chatMatchesSearch(query, topic)) {
      apart.push(topic);
    }
  }
  return { byThread, apart };
}

/**
 * The Chats list with the topics' conversations first, in the topics' own order (`topicThreadIds`),
 * whatever each is doing: a topic keeps its place while it works, waits or sits unread.
 * `threadIdOf` answers null for a row that stays where it is.
 */
export function pinTopicChats<T>(
  items: ReadonlyArray<T>,
  threadIdOf: (item: T) => string | null,
  topicThreadIds: ReadonlyArray<string>,
): { readonly items: Array<T>; readonly pinned: number } {
  const place = new Map(topicThreadIds.map((id, index) => [id, index]));
  const placeOf = (item: T) => {
    const id = threadIdOf(item);
    return id === null ? undefined : place.get(id);
  };
  const topics = items
    .filter((item) => placeOf(item) !== undefined)
    .sort((left, right) => placeOf(left)! - placeOf(right)!);
  return {
    items: [...topics, ...items.filter((item) => placeOf(item) === undefined)],
    pinned: topics.length,
  };
}

/**
 * Where the topics with no conversation yet go among the pinned ones, so the topics read as one
 * list in their own order (`order`, by topic id): before the next topic that has a row (`before`,
 * by that row's thread id), or after the last one (`after`).
 */
export function placeUnopenedTopics(
  order: ReadonlyArray<string>,
  byThread: ReadonlyMap<string, TopicRow>,
  apart: ReadonlyArray<TopicRow>,
): {
  readonly before: ReadonlyMap<string, ReadonlyArray<TopicRow>>;
  readonly after: ReadonlyArray<TopicRow>;
} {
  const threadOf = new Map([...byThread].map(([threadId, topic]) => [topic.id, threadId]));
  const unopened = new Map(apart.map((topic) => [topic.id, topic]));
  const before = new Map<string, ReadonlyArray<TopicRow>>();
  let waiting: Array<TopicRow> = [];
  for (const id of order) {
    const topic = unopened.get(id);
    if (topic !== undefined) {
      waiting.push(topic);
      continue;
    }
    const threadId = threadOf.get(id);
    if (threadId === undefined || waiting.length === 0) continue;
    before.set(threadId, waiting);
    waiting = [];
  }
  return { before, after: waiting };
}

/**
 * The Chats list with each topic's other chats folded under the topic's row: taken out of their
 * own places, and put back right under the topic only while it is unfolded. `threadIdOf` answers
 * null for a row that stays where it is (a label, a shelf, a chat marked as done).
 */
export function foldSideChats<T>(
  items: ReadonlyArray<T>,
  threadIdOf: (item: T) => string | null,
  topicsByThread: ReadonlyMap<string, Pick<TopicRow, "id" | "sideThreadIds">>,
  unfolded: ReadonlySet<string>,
): {
  readonly items: Array<T>;
  /** How many chats are folded under each topic's row, by the topic's thread id. */
  readonly counts: ReadonlyMap<string, number>;
  /** The chats drawn under a topic, by thread id. */
  readonly nested: ReadonlySet<string>;
} {
  const listed = new Set(items.flatMap((item) => threadIdOf(item) ?? []));
  const ownerOf = new Map<string, string>();
  for (const [threadId, topic] of topicsByThread) {
    if (!listed.has(threadId)) continue;
    for (const side of topic.sideThreadIds ?? []) ownerOf.set(side, threadId);
  }
  const sides = new Map<string, Array<T>>();
  const kept: Array<T> = [];
  for (const item of items) {
    const id = threadIdOf(item);
    const owner = id === null ? undefined : ownerOf.get(id);
    if (owner === undefined) kept.push(item);
    else sides.set(owner, [...(sides.get(owner) ?? []), item]);
  }
  const folded: Array<T> = [];
  const nested = new Set<string>();
  for (const item of kept) {
    folded.push(item);
    const id = threadIdOf(item);
    const topic = id === null ? undefined : topicsByThread.get(id);
    if (id === null || topic === undefined || !unfolded.has(topic.id)) continue;
    for (const side of sides.get(id) ?? []) {
      folded.push(side);
      nested.add(threadIdOf(side)!);
    }
  }
  return {
    items: folded,
    counts: new Map([...sides].map(([owner, chats]) => [owner, chats.length])),
    nested,
  };
}
