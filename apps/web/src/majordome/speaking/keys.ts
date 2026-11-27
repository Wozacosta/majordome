/** The key of a reply across the chats in this window. */
export const readAloudReplyKey = (chat: string, replyId: string) => `${chat}:${replyId}`;
/** The key of a voice sampled in Settings. */
export const voiceSampleKey = (voice: number) => `voice:${voice}`;
