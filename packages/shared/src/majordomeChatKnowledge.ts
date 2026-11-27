import type { MajordomeChatKnowledgeResult } from "@t3tools/contracts";

/** A note or folder a chat starts with, or a topic it only knows the standing of. */
export interface ChatKnowledgeRow {
  readonly key: string;
  readonly kind: "memory" | "me" | "daily" | "topic" | "other-topic";
  readonly label: string;
  readonly detail: string | null;
  /** The note to open for it, relative to the notes folder; null when there is none to show. */
  readonly path: string | null;
}

export interface ChatKnowledgeView {
  /** What the chat has read before the first message. */
  readonly starts: ReadonlyArray<ChatKnowledgeRow>;
  /** The topics it is only told the standing of: the ones shown first. */
  readonly others: ReadonlyArray<ChatKnowledgeRow>;
  /** The ones past those, shown when asked for. */
  readonly rest: ReadonlyArray<ChatKnowledgeRow>;
}

export const CHAT_KNOWLEDGE_TITLE = "What this chat knows";
export const CHAT_KNOWLEDGE_OTHERS_TITLE = "Other topics";
export const CHAT_KNOWLEDGE_TOPICS_TITLE = "Your topics";
export const CHAT_KNOWLEDGE_OTHERS_LINE =
  "Only where each one stands. It looks inside a topic when your question touches it, and says which.";

const OTHERS_SHOWN = 8;

/** Null when the chat has no notes folder, or nothing in it to start with. */
export function chatKnowledgeView(
  knowledge: MajordomeChatKnowledgeResult | null,
): ChatKnowledgeView | null {
  if (knowledge === null || !knowledge.isVault) return null;
  const starts: Array<ChatKnowledgeRow> = [];
  if (knowledge.topic !== null) {
    starts.push({
      key: "topic",
      kind: "topic",
      label: `Notes of ${knowledge.topic.title}`,
      detail: "This topic's own notes",
      path: null,
    });
  }
  starts.push({
    key: "memory",
    kind: "memory",
    label: "Memory note",
    detail:
      knowledge.memory === null
        ? "Empty so far. Facts for every chat go here."
        : knowledge.memory.cut
          ? "Shared by every chat. Too long: its end is left out."
          : "Shared by every chat",
    path: knowledge.memory?.path ?? null,
  });
  if (knowledge.me != null) {
    starts.push({
      key: "me",
      kind: "me",
      label: "About you",
      detail: "Your name and contact details",
      path: knowledge.me.path,
    });
  }
  for (const note of knowledge.dailyNotes) {
    starts.push({
      key: note.day,
      kind: "daily",
      label: note.day === "today" ? "Today's note" : "Yesterday's note",
      detail: null,
      path: note.path,
    });
  }
  const others = knowledge.otherTopics.map((topic): ChatKnowledgeRow => ({
    key: topic.id,
    kind: "other-topic",
    label: topic.title,
    detail: topic.standing,
    path: topic.standing === null ? null : `${topic.folder}/log.md`,
  }));
  return {
    starts,
    others: others.slice(0, OTHERS_SHOWN),
    rest: others.slice(OTHERS_SHOWN),
  };
}
