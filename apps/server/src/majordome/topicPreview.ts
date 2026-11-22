/**
 * What the app says of a topic in a line or a few: the gist of its conversation's latest message,
 * the owner's or the agent's, and where things stand as its log puts it, both as plain text.
 */

import type { MajordomeTopicMessagePreview } from "@t3tools/contracts";

const TOPIC_PREVIEW_CHAR_LIMIT = 120;

export interface TopicPreviewMessage {
  readonly author: MajordomeTopicMessagePreview["author"];
  readonly text: string;
}

function plainLine(line: string): string {
  return (
    line
      // Images and links keep their words, wikilinks their alias or name.
      .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replaceAll(/\[\[([^\]]+)\]\]/g, "$1")
      .replaceAll(/<[^>]+>/g, "")
      .replace(/^\s*(?:>\s*)+/, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replaceAll(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replaceAll(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2")
      .replaceAll(/`([^`]*)`/g, "$1")
      .replaceAll(/\s+/g, " ")
      .trim()
  );
}

/** The first line of `markdown` that says something, as plain text, cut to `limit`. */
export function firstMeaningfulLine(
  markdown: string,
  limit = TOPIC_PREVIEW_CHAR_LIMIT,
): string | null {
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    // Rules and table separators carry no words.
    if (inFence || /^\s*([-*_=|:+]\s*){3,}$/.test(raw)) continue;
    const cells = /^\s*\|/.test(raw)
      ? raw
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell !== "")
          .join(" · ")
      : raw;
    const line = plainLine(cells);
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
  }
  return null;
}

/** The preview from a conversation's latest messages, oldest first: the latest with words in it. */
export function pickTopicPreview(
  messages: ReadonlyArray<TopicPreviewMessage>,
): MajordomeTopicMessagePreview | null {
  for (const message of messages.toReversed()) {
    const text = firstMeaningfulLine(message.text);
    if (text !== null) return { author: message.author, text };
  }
  return null;
}

const STANDING_LINE_LIMIT = 4;
const STANDING_CHAR_LIMIT = 400;

/**
 * Where a topic stands, as the "Where things stand" section of its log says: its first few lines
 * as plain text, up to the next heading. Null when the log has no such section or it is empty.
 */
export function topicStanding(log: string): string | null {
  const lines: Array<string> = [];
  let inSection = false;
  for (const raw of log.split(/\r?\n/)) {
    if (/^\s{0,3}#{1,6}\s/.test(raw)) {
      if (inSection) break;
      inSection = /^\s*#+\s+where things stand\s*:?\s*#*\s*$/i.test(raw);
      continue;
    }
    if (!inSection) continue;
    const line = plainLine(raw);
    if (/[\p{L}\p{N}]/u.test(line)) lines.push(line);
    if (lines.length === STANDING_LINE_LIMIT) break;
  }
  const text = lines.join("\n");
  if (text === "") return null;
  return text.length <= STANDING_CHAR_LIMIT
    ? text
    : `${text.slice(0, STANDING_CHAR_LIMIT - 1).trimEnd()}…`;
}
