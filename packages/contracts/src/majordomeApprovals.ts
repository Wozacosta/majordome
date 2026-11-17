import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TurnItemId } from "./baseSchemas.ts";

/** Names the card an assistant's question shows in its conversation. */
export const MajordomeApprovalInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
});
export type MajordomeApprovalInput = typeof MajordomeApprovalInput.Type;

/** Something an assistant wants to change in the app, waiting for the owner's yes or no. */
export const MajordomeApproval = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  /** What it wants to do, read after "Majordome wants to:". */
  title: Schema.String,
  /** What that means for the owner, in plain words. */
  detail: Schema.String,
  /** The conversation or routine run that asks. */
  threadTitle: Schema.String,
  requestedAt: IsoDateTime,
  /** With no answer by then, the answer is no. */
  expiresAt: IsoDateTime,
});
export type MajordomeApproval = typeof MajordomeApproval.Type;

export const MajordomeAnswerApprovalInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  allow: Schema.Boolean,
});
export type MajordomeAnswerApprovalInput = typeof MajordomeAnswerApprovalInput.Type;

/** What each failure says to the owner. Clients read it by `reason`. */
export const MAJORDOME_APPROVAL_FAILURE_MESSAGES = {
  request_closed: "This question is no longer waiting for an answer.",
  agent_stopped: "The assistant that asked has stopped, so there is nothing to allow.",
  thread_unavailable: "Majordome could not read that conversation.",
} as const;

export const MajordomeApprovalFailureReason = Schema.Literals(
  Object.keys(MAJORDOME_APPROVAL_FAILURE_MESSAGES) as Array<
    keyof typeof MAJORDOME_APPROVAL_FAILURE_MESSAGES
  >,
);
export type MajordomeApprovalFailureReason = typeof MajordomeApprovalFailureReason.Type;

export class MajordomeApprovalError extends Schema.TaggedError<MajordomeApprovalError>()(
  "MajordomeApprovalError",
  {
    reason: MajordomeApprovalFailureReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return MAJORDOME_APPROVAL_FAILURE_MESSAGES[this.reason];
  }
}
