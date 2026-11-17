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
import { CheckIcon, MinusIcon, ShieldQuestionIcon } from "lucide-react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkLogRow } from "../chat/WorkLog";
import { approvalFailureMessage, approvalOutcomeLabel } from "./approvals.logic";
import { OwnerAnswerButtons } from "./OwnerAnswerButtons";
import { Muted } from "./paper";

type RequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "secret_request" }>;

/** The assistant asks before it changes a setting: the owner allows it or says no. */
export function ApprovalRequestCard({
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
        ? ShieldQuestionIcon
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
              : approvalOutcomeLabel(item.secretStatus)}
          </>
        }
      />
    );
  }
  return (
    <div
      data-v2-item-type={item.type}
      data-approval-request
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <ShieldQuestionIcon className="size-4 shrink-0 text-icon-muted" aria-hidden />
          <span className="min-w-0 wrap-anywhere">Majordome wants to: {item.label}</span>
        </p>
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      <ApprovalActions
        environmentId={environmentId}
        threadId={item.threadId}
        turnItemId={item.id}
      />
      <Muted className="text-xs">Nothing changes unless you allow it.</Muted>
    </div>
  );
}

/** "Allow" and "Don't allow", wherever the owner answers: the conversation or the feed. */
function ApprovalActions({
  environmentId,
  threadId,
  turnItemId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
}) {
  const answer = useAtomCommand(majordomeEnvironment.answerApproval, {
    label: "answer approval",
    reportFailure: false,
    reportDefect: false,
  });
  const canAnswer = useAtomValue(majordomeEnvironment.answerApproval.permissionAtom(environmentId));
  if (!canAnswer) return <Muted>This connection can't change settings, so it can't answer.</Muted>;
  return (
    <OwnerAnswerButtons
      allowLabel="Allow"
      answer={async (allow) => {
        const result = await answer({ environmentId, input: { threadId, turnItemId, allow } });
        return result._tag === "Failure" && !isAtomCommandInterrupted(result)
          ? approvalFailureMessage(squashAtomCommandFailure(result))
          : null;
      }}
    />
  );
}

/**
 * In the feed's "Needs you": when the card a run waits on asks to change a setting, what it asks
 * and the two answers. Nothing for any other card, or on a server from before this.
 */
export function ApprovalFeedRequest({
  environmentId,
  threadId,
  turnItemId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
}) {
  const request = AsyncResult.getOrElse(
    useAtomValue(majordomeEnvironment.approval({ environmentId, input: { threadId, turnItemId } })),
    () => null,
  );
  if (request === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-approval-request>
      <p className="min-w-0 wrap-anywhere">
        Wants to: {request.title}.{request.detail ? ` ${request.detail}` : ""}
      </p>
      <ApprovalActions environmentId={environmentId} threadId={threadId} turnItemId={turnItemId} />
    </div>
  );
}
