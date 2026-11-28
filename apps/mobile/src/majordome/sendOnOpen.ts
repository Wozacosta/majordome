import { useEffect } from "react";

/** How long what home asked for waits for the new chat it opens. */
const INTENT_LASTS_MS = 15_000;

/** "send": the message leaves by itself. "write": the message box takes the keyboard. */
type OnOpen = "send" | "write";

let asked: { readonly what: OnOpen; readonly atMs: number } | null = null;

/** Today's box was sent: the new chat that opens next sends what it holds, once it can. */
export function noteSendOnOpen(now = Date.now()): void {
  asked = { what: "send", atMs: now };
}

/** Home's camera took a photo: the new chat that opens next waits for the owner's words. */
export function noteWriteOnOpen(now = Date.now()): void {
  asked = { what: "write", atMs: now };
}

function takeOnOpen(what: OnOpen, now: number): boolean {
  if (asked === null) return false;
  const fresh = now - asked.atMs <= INTENT_LASTS_MS;
  if (fresh && asked.what !== what) return false;
  asked = null;
  return fresh;
}

/** True once, for the new chat Today opened. */
export function takeSendOnOpen(now = Date.now()): boolean {
  return takeOnOpen("send", now);
}

/** True once, for the new chat home's camera opened. */
export function takeWriteOnOpen(now = Date.now()): boolean {
  return takeOnOpen("write", now);
}

/**
 * In a new chat home opened: sends what the box held as soon as the chat can send, so the owner
 * does not press send twice; after a photo, gives the message box the keyboard instead, since a
 * photo alone asks nothing.
 */
export function SendOnOpen(props: {
  readonly ready: boolean;
  readonly isDraft: boolean;
  readonly onSend: () => void;
  readonly onWrite: () => void;
}): null {
  const { ready, isDraft, onSend, onWrite } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Today opened this chat from outside it; the message leaves once the chat is on screen and able to send
  useEffect(() => {
    if (ready && takeSendOnOpen()) onSend();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `onSend` is new each render; only becoming ready sends
  }, [ready]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- home's camera opened this chat from outside it; the keyboard comes up a frame after the message box is on screen
  useEffect(() => {
    if (!isDraft || !takeWriteOnOpen()) return;
    const frame = requestAnimationFrame(onWrite);
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `onWrite` is new each render; only the new chat appearing focuses
  }, [isDraft]);
  return null;
}
