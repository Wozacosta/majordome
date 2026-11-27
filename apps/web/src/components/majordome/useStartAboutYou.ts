import type { ScopedProjectRef } from "@t3tools/contracts";
import { START_ABOUT_YOU_REQUEST } from "@t3tools/shared/majordome";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { toastManager } from "../ui/toast";
import { requestDraftSend } from "./pendingDraftSend";

/** Starts a chat that fills the note about the owner from their notes, as Today's box starts one. */
export function useStartAboutYou() {
  const handleNewThread = useNewThreadHandler();
  return async (project: ScopedProjectRef) => {
    const opened = await handleNewThread(project, { prompt: START_ABOUT_YOU_REQUEST }).catch(
      (error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not start the chat",
          description: error instanceof Error ? error.message : undefined,
        });
        return null;
      },
    );
    // A draft that already held other text kept it; that one is the owner's to send.
    if (
      opened !== null &&
      useComposerDraftStore.getState().getComposerDraft(opened.draftId)?.prompt ===
        START_ABOUT_YOU_REQUEST
    ) {
      requestDraftSend(opened.draftId);
    }
  };
}
