/** Chats whose next message is said aloud, and the id that message left with. */
const armed = new Map<string, { messageId: string | null }>();
/** Messages that left marked spoken and are not known to have arrived yet. */
const leaving = new Map<string, { messageId: string | null }>();

/**
 * Marks the next message a chat sends as spoken. The composer's send takes no such option, so
 * voice mode arms it around its own send and the send picks it up as the message leaves.
 * `messageId` is the message that left, or null when none did; call `disarm` once the send has
 * settled, sent or not.
 */
export function armSpokenSend(chatKey: string): {
  readonly messageId: () => string | null;
  readonly disarm: () => void;
} {
  const own = { messageId: null as string | null };
  armed.set(chatKey, own);
  return {
    messageId: () => own.messageId,
    disarm: () => {
      if (armed.get(chatKey) === own) armed.delete(chatKey);
    },
  };
}

/** What the composer's send adds to a message as it leaves: the spoken flag when voice mode sent it. */
export function spokenSend(chatKey: string, messageId: string): { readonly replyStyle?: "spoken" } {
  const own = armed.get(chatKey);
  if (!own) return {};
  armed.delete(chatKey);
  own.messageId = messageId;
  leaving.set(messageId, own);
  return { replyStyle: "spoken" };
}

/** The composer's send settled this message: voice mode forgets one that did not arrive. */
export function spokenSendSettled(messageId: string, sent: boolean): void {
  const own = leaving.get(messageId);
  leaving.delete(messageId);
  if (own && !sent) own.messageId = null;
}
