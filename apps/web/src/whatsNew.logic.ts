export interface WhatsNewGroup {
  readonly title: string | null;
  readonly items: ReadonlyArray<string>;
}

export type WhatsNewInline =
  | { readonly kind: "text" | "bold" | "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

const GROUP_TITLE = /^\*\*([^*]+)\*\*$/;
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** A version's notes are titled groups ("New", "Try this") of bullets wrapped over several lines. */
export function parseWhatsNewNotes(notes: string): ReadonlyArray<WhatsNewGroup> {
  const groups: Array<{ title: string | null; items: string[] }> = [];
  let continues = false;
  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continues = false;
      continue;
    }
    const title = GROUP_TITLE.exec(line);
    if (title) {
      groups.push({ title: title[1]!, items: [] });
      continues = false;
      continue;
    }
    const group = groups.at(-1) ?? groups[groups.push({ title: null, items: [] }) - 1]!;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!bullet && continues && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${line}`;
    } else {
      group.items.push(bullet ? bullet[1]! : line);
    }
    continues = true;
  }
  return groups.filter((group) => group.items.length > 0);
}

export function splitWhatsNewInline(text: string): ReadonlyArray<WhatsNewInline> {
  const parts: WhatsNewInline[] = [];
  let end = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > end) parts.push({ kind: "text", text: text.slice(end, match.index) });
    if (match[1] !== undefined) parts.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: "code", text: match[2] });
    else parts.push({ kind: "link", text: match[3]!, href: match[4]! });
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({ kind: "text", text: text.slice(end) });
  return parts;
}

/**
 * Whether opening the app on `version` is worth a notice. A first launch has nothing to compare
 * with, so a new install is not told it was updated.
 */
export function isFirstLaunchAfterUpdate(lastSeenVersion: string | null, version: string) {
  return lastSeenVersion !== null && lastSeenVersion !== version;
}
