const LABEL = "replies:";
const MAX_REPLIES = 3;
const MAX_REPLY_LENGTH = 40;

export interface QuickRepliesSplit {
  /** The message as the person reads it, without the replies line. */
  readonly body: string;
  readonly replies: ReadonlyArray<string>;
}

/**
 * Splits the assistant's closing `Replies: Yes, set it | No thanks` line off its message. Only the
 * last non-empty line counts, and only with one to three short replies; anything else is ordinary
 * text. While the message streams, a last line that is or may become that line is held back, so it
 * never shows as text.
 */
export function splitQuickReplies(text: string, streaming = false): QuickRepliesSplit {
  const end = text.trimEnd().length;
  const lineStart = text.lastIndexOf("\n", end - 1) + 1;
  const line = text.slice(lineStart, end).trim();
  const lower = line.toLowerCase();
  const untouched = { body: text, replies: [] };
  if (line === "") return untouched;
  const body = text.slice(0, lineStart).trimEnd();
  if (streaming) {
    return lower.startsWith(LABEL) || LABEL.startsWith(lower) ? { body, replies: [] } : untouched;
  }
  if (!lower.startsWith(LABEL)) return untouched;
  const replies = line
    .slice(LABEL.length)
    .split("|")
    .map((reply) => reply.trim());
  return replies.length <= MAX_REPLIES &&
    replies.every((reply) => reply !== "" && reply.length <= MAX_REPLY_LENGTH)
    ? { body, replies }
    : untouched;
}
