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
