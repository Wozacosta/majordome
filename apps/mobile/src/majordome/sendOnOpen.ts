import { useEffect } from "react";

/** How long a message typed on Today waits for the new chat it opens. */
const INTENT_LASTS_MS = 15_000;

let askedAtMs: number | null = null;

/** Today's box was sent: the new chat that opens next sends what it holds, once it can. */
export function noteSendOnOpen(now = Date.now()): void {
  askedAtMs = now;
}

/** True once, for the new chat Today opened. */
export function takeSendOnOpen(now = Date.now()): boolean {
  const asked = askedAtMs;
  askedAtMs = null;
  return asked !== null && now - asked <= INTENT_LASTS_MS;
}

/**
 * In a new chat Today's box opened: sends what the box held as soon as the chat can send, so the
 * owner does not press send twice.
 */
export function SendOnOpen(props: { readonly ready: boolean; readonly onSend: () => void }): null {
  const { ready, onSend } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Today opened this chat from outside it; the message leaves once the chat is on screen and able to send
  useEffect(() => {
    if (ready && takeSendOnOpen()) onSend();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `onSend` is new each render; only becoming ready sends
  }, [ready]);
  return null;
}
