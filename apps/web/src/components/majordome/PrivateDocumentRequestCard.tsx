import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { CheckIcon, FileLockIcon, MinusIcon } from "lucide-react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkLogRow } from "../chat/WorkLog";
import { OwnerAnswerButtons } from "./OwnerAnswerButtons";
import { Muted } from "./paper";
import { privateDocumentFailureMessage, requestOutcomeLabel } from "./privateDocuments.logic";

type RequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "secret_request" }>;

/** The assistant asks to open one private document: the owner allows it once or says no. */
export function PrivateDocumentRequestCard({
  environmentId,
  item,
  visibility,
}: {
  readonly environmentId: EnvironmentId;
  readonly item: RequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  // A card copied into another conversation (a fork) can only be answered where it was asked.
  if (item.secretStatus !== "pending" || visibility !== "local") {
    const Icon =
      item.secretStatus === "pending"
        ? FileLockIcon
        : item.secretStatus === "saved"
          ? CheckIcon
          : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          <>
            {item.label} ·{" "}
            {item.secretStatus === "pending"
              ? "Waiting for an answer where it was asked"
              : requestOutcomeLabel(item.secretStatus)}
          </>
        }
      />
    );
  }
  return (
    <div
      data-v2-item-type={item.type}
      data-private-document-request
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <FileLockIcon className="size-4 shrink-0 text-icon-muted" aria-hidden />
          <span className="min-w-0 wrap-anywhere">Open “{item.label}”?</span>
        </p>
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      <PrivateDocumentRequestActions
        environmentId={environmentId}
        threadId={item.threadId}
        turnItemId={item.id}
      />
      <Muted className="text-xs">
        Allowing opens this one private document for this conversation. Its readable copy is deleted
        when the run ends or after 15 minutes.
      </Muted>
    </div>
  );
}

/** "Allow once" and "Don't allow", wherever the owner answers: the conversation or the feed. */
function PrivateDocumentRequestActions({
  environmentId,
  threadId,
  turnItemId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
}) {
  const answer = useAtomCommand(majordomeEnvironment.answerPrivateDocumentRequest, {
    label: "answer private document request",
    reportFailure: false,
    reportDefect: false,
  });
  const canAnswer = useAtomValue(
    majordomeEnvironment.answerPrivateDocumentRequest.permissionAtom(environmentId),
  );
  if (!canAnswer) return <Muted>This connection can't answer for private documents.</Muted>;
  return (
    <OwnerAnswerButtons
      allowLabel="Allow once"
      answer={async (allow) => {
        const result = await answer({ environmentId, input: { threadId, turnItemId, allow } });
        return result._tag === "Failure" && !isAtomCommandInterrupted(result)
          ? privateDocumentFailureMessage(squashAtomCommandFailure(result))
          : null;
      }}
    />
  );
}

/**
 * In the feed's "Needs you": when the card a run waits on is a private document request, what it
 * asks and the two answers. Nothing for any other card, or on a server from before this.
 */
export function PrivateDocumentFeedRequest({
  environmentId,
  threadId,
  turnItemId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
}) {
  const request = AsyncResult.getOrElse(
    useAtomValue(
      majordomeEnvironment.privateDocumentRequest({
        environmentId,
        input: { threadId, turnItemId },
      }),
    ),
    () => null,
  );
  if (request === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-private-document-request>
      <p className="min-w-0 wrap-anywhere">
        Asks to open your private document “{request.documentName}”.
        {request.reason ? ` ${request.reason}` : ""}
      </p>
      <PrivateDocumentRequestActions
        environmentId={environmentId}
        threadId={threadId}
        turnItemId={turnItemId}
      />
    </div>
  );
}
