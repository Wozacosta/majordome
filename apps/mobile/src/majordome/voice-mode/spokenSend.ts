/** Chats whose next message is said aloud, so its answer should be spoken too. */
const armed = new Set<string>();

// The same key the chat's screen is known by (`scopedThreadKey`).
const chatKey = (message: { readonly environmentId: string; readonly threadId: string }) =>
  `${message.environmentId}:${message.threadId}`;

/**
 * Marks the next message a chat sends as spoken. The composer's send path has no room for the
 * flag, so voice mode arms it around its own send and the outbox picks it up on the way in.
 * Call the returned function once the send has settled, sent or not.
 */
export function armSpokenReply(key: string): () => void {
  armed.add(key);
  return () => void armed.delete(key);
}

/** The message as the outbox should keep it: marked spoken when voice mode sent it. */
export function withSpokenReply<
  Message extends { readonly environmentId: string; readonly threadId: string },
>(message: Message): Message & { readonly replyStyle?: "spoken" } {
  return armed.delete(chatKey(message)) ? { ...message, replyStyle: "spoken" } : message;
}
