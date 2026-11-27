import type { OrchestrationV2ReplyStyle } from "@t3tools/contracts";

/** Appended to the turn's prompt, never to the message the transcript shows. */
export const SPOKEN_REPLY_INSTRUCTIONS = [
  "The user said this aloud, and your reply to this message will be read aloud to them.",
  "Answer in at most five short spoken sentences, in the language they spoke, as you would to someone in the room: only the one or two things that matter most.",
  "No tables, lists, headings, code or backticks. Name a command or a file in plain words.",
  "When you did work, or there is more than you said, end with one sentence saying that the detail is on screen.",
].join("\n");

/** The turn's prompt with what its reply style asks of the answer. */
export const withReplyStyle = (
  text: string,
  replyStyle: OrchestrationV2ReplyStyle | undefined,
): string => (replyStyle === "spoken" ? `${text}\n\n${SPOKEN_REPLY_INSTRUCTIONS}` : text);
