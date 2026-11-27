/** How long a "Talk" shortcut waits for the new chat it opens. */
const INTENT_LASTS_MS = 15_000;

let askedAtMs: number | null = null;

/** The "Talk" shortcut was used: the new chat that opens next starts in voice mode. */
export function noteTalkShortcut(href: string, talkHref: string, now = Date.now()): void {
  if (href === talkHref) askedAtMs = now;
}

/** True once, for the new chat the shortcut opened. */
export function takeTalkIntent(now = Date.now()): boolean {
  const asked = askedAtMs;
  askedAtMs = null;
  return asked !== null && now - asked <= INTENT_LASTS_MS;
}
