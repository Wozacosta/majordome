import type { MessageId } from "@t3tools/contracts";
import { use } from "react";

import { useDiffPanelStore } from "../../diffPanelStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell, useThreadCheckpointSummaries } from "../../state/entities";
import { TimelineRowCtx } from "../chat/timelineRowContext";
import { SavedNotesCard } from "./SavedNotesCard";

/**
 * Under a reply, the notes it saved. Upstream dropped its changed-files card under replies; in
 * Majordome that card is how the owner sees what was written to their notes, so it stays.
 */
export function SavedNotes({ messageId }: { readonly messageId: MessageId }) {
  const { threadRef } = use(TimelineRowCtx);
  const thread = useQuietThreadShell(threadRef);
  const summary = useThreadCheckpointSummaries(threadRef).find(
    (candidate) => candidate.assistantMessageId === messageId,
  );
  if (threadRef === null || !thread?.projectId || !summary || summary.files.length === 0) {
    return null;
  }
  return (
    <SavedNotesCard
      files={summary.files.map((file) => file.path)}
      projectId={thread.projectId}
      environmentId={thread.environmentId}
      onSeeChanges={() => {
        useDiffPanelStore.getState().selectTurn(threadRef, summary.runId, summary.files[0]?.path);
        useRightPanelStore.getState().open(threadRef, "diff");
      }}
    />
  );
}
