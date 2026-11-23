import type { ReactNode } from "react";

import { AppBar } from "../components/ui/AppBar";
import { useWorkspaceBackNavigation } from "../features/layout/workspace/useAndroidWorkspaceNavigation";
import type { NewTaskDraftRouteParams } from "../features/threads/thread-route-state";
import { ThreadScreenFallback } from "../features/threads/ThreadScreenHost";
import { MajordomeNewChatUnavailable, useNewChatStart } from "./NewChatHero";

/** Points a new chat at the notes folder, whatever the route asked for, or says why it cannot start. */
export function MajordomeNewChatRoute(props: {
  readonly params: NewTaskDraftRouteParams;
  readonly render: (params: NewTaskDraftRouteParams) => ReactNode;
}) {
  const goBack = useWorkspaceBackNavigation();
  const { draftId, incomingShareId } = props.params;
  const start = useNewChatStart((Array.isArray(draftId) ? draftId[0] : draftId) !== undefined);
  if (start.kind === "draft") return props.render(props.params);
  if (start.kind === "notes") {
    return props.render({
      environmentId: start.environmentId,
      projectId: start.projectId,
      incomingShareId,
    });
  }
  return (
    <ThreadScreenFallback header={<AppBar title="New chat" onBack={goBack} />}>
      <MajordomeNewChatUnavailable looking={start.kind === "looking"} />
    </ThreadScreenFallback>
  );
}
