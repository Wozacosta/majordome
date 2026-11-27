import type { ConversationNeed, ConversationReply } from "@t3tools/client-runtime/speaking";

/** A chat as voice mode needs to see it, taken from the thread's projection. */
export interface TurnSnapshot {
  readonly runs: ReadonlyArray<{
    readonly id: string;
    readonly userMessageId: string;
    readonly status: string;
  }>;
  readonly messages: ReadonlyArray<{
    readonly runId: string | null;
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
    readonly workflowScript?: boolean | undefined;
  }>;
  /** What waits for the user on screen: an approval or a question, with its request id. */
  readonly needs: { readonly kind: ConversationNeed; readonly id: string } | null;
  readonly connected: boolean;
}

export interface TurnReplyRouter {
  /**
   * Routes the answer to `messageId`, and only that one, to `reply`. A later call replaces
   * the turn being followed; the earlier turn's reply is never called again.
   */
  watch(messageId: string, reply: ConversationReply, onAnswered: () => void): () => void;
  update(snapshot: TurnSnapshot): void;
}

const SETTLED = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);

/** Follows one user message through its turn. Tool activity is not text, so it is never spoken. */
export function createTurnReplyRouter(): TurnReplyRouter {
  let watched: {
    readonly messageId: string;
    readonly reply: ConversationReply;
    readonly onAnswered: () => void;
    askedId: string | null;
    done: boolean;
    /** The reply so far, and how much of each of the turn's messages is in it. */
    text: string;
    readonly parts: Array<{ taken: number; closed: boolean }>;
  } | null = null;
  let latest: TurnSnapshot | null = null;

  const route = () => {
    const turn = watched;
    const snapshot = latest;
    if (!turn || !snapshot || turn.done) return;
    const run = snapshot.runs.find((candidate) => candidate.userMessageId === turn.messageId);
    if (run) {
      const parts = snapshot.messages.filter(
        (message) =>
          message.runId === run.id && message.role === "assistant" && !message.workflowScript,
      );
      // The loop reads the reply as text that only grows. A finished message closes its
      // paragraph, so its last sentence is not held back for more text: what the assistant
      // wrote before asking for approval is said before the ask.
      parts.forEach((message, index) => {
        const part = (turn.parts[index] ??= { taken: 0, closed: false });
        if (message.text.length > part.taken) {
          turn.text += message.text.slice(part.taken);
          part.taken = message.text.length;
          part.closed = false;
        }
        if (!message.streaming && !part.closed) {
          part.closed = true;
          turn.text += "\n\n";
        }
      });
      const text = turn.text;
      if (text !== "") turn.reply.onReplyText(text);
      if (watched !== turn) return;

      if (snapshot.needs && !SETTLED.has(run.status)) {
        if (turn.askedId !== snapshot.needs.id) {
          turn.askedId = snapshot.needs.id;
          turn.reply.onNeedsUser(snapshot.needs.kind);
        }
        return;
      }
      if (turn.askedId !== null) {
        turn.askedId = null;
        turn.onAnswered();
        if (watched !== turn) return;
      }
      if (SETTLED.has(run.status) && !parts.some((message) => message.streaming)) {
        turn.done = true;
        turn.reply.onReplyDone();
        return;
      }
    }
    if (!snapshot.connected) {
      turn.done = true;
      turn.reply.onConnectionLost();
    }
  };

  return {
    watch(messageId, reply, onAnswered) {
      const turn = {
        messageId,
        reply,
        onAnswered,
        askedId: null,
        done: false,
        text: "",
        parts: [],
      };
      watched = turn;
      route();
      return () => {
        if (watched === turn) watched = null;
      };
    },
    update(snapshot) {
      latest = snapshot;
      route();
    },
  };
}
