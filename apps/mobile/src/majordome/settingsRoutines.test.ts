import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createDraft, unbindDraftFromThread } from "../features/settings/scheduledTaskDraft";

describe("a routine made on the phone", () => {
  it("works in the notes folder, in one conversation, and asks before more than editing notes", () => {
    expect(createDraft("notes" as ProjectId, null)).toMatchObject({
      workspace: "root",
      threadMode: "fresh_session",
      runtimeMode: "auto-accept-edits",
    });
  });

  it("stays in the notes folder when it leaves its chat", () => {
    const draft = { ...createDraft("notes" as ProjectId, null), threadId: "chat" as ThreadId };
    expect(unbindDraftFromThread(draft)).toMatchObject({ threadId: null, workspace: "root" });
  });
});
