import { create } from "zustand";

import type { DraftId } from "../../composerDraftStore";

/**
 * The draft Today's capture box filled in and wants sent. The draft's own chat view sends it once
 * its composer is there, so the message leaves exactly as one typed on the new-thread page does.
 */
export const usePendingDraftSendStore = create<{ readonly draftId: DraftId | null }>()(() => ({
  draftId: null,
}));

export function requestDraftSend(draftId: DraftId): void {
  usePendingDraftSendStore.setState({ draftId });
}

/** True once, for the draft that was asked for. */
export function consumeDraftSend(draftId: DraftId): boolean {
  if (usePendingDraftSendStore.getState().draftId !== draftId) return false;
  usePendingDraftSendStore.setState({ draftId: null });
  return true;
}
