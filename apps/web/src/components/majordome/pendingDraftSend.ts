import { create } from "zustand";

import type { DraftId } from "../../composerDraftStore";

/**
 * The draft Today's capture box filled in. The draft's own chat view sends it once its composer is
 * there, so the message leaves exactly as one typed on the new-thread page does. With files, the
 * composer takes them instead and the owner sends, since files are still being read then.
 */
export const usePendingDraftSendStore = create<{
  readonly draftId: DraftId | null;
  readonly files: ReadonlyArray<File>;
}>()(() => ({ draftId: null, files: [] }));

export function requestDraftSend(draftId: DraftId, files: ReadonlyArray<File> = []): void {
  usePendingDraftSendStore.setState({ draftId, files });
}

/** The files to attach (none means send now), once, for the draft that was asked for. */
export function consumeDraftSend(draftId: DraftId): ReadonlyArray<File> | null {
  const { draftId: pending, files } = usePendingDraftSendStore.getState();
  if (pending !== draftId) return null;
  usePendingDraftSendStore.setState({ draftId: null, files: [] });
  return files;
}

const usePendingFirstAskStore = create<{ readonly text: string }>()(() => ({ text: "" }));

/** What the owner asked for at setup, kept for Today's box when no chat could be started yet. */
export function keepFirstAsk(text: string): void {
  usePendingFirstAskStore.setState({ text });
}

/** That text, once. */
export function takeFirstAsk(): string {
  const { text } = usePendingFirstAskStore.getState();
  if (text !== "") usePendingFirstAskStore.setState({ text: "" });
  return text;
}
