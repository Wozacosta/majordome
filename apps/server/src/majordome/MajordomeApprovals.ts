/**
 * An agent asks the owner before it changes something that is hard to take back. The question is
 * a card in the asking conversation ("Majordome wants to: …") with a push; nothing happens until
 * the owner allows it there. See `ownerRequestCards.ts` for the wait.
 */

import {
  type MajordomeAnswerApprovalInput,
  type MajordomeApproval,
  MajordomeApprovalError,
  type MajordomeApprovalInput,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import * as OwnerRequestCards from "./ownerRequestCards.ts";

export type ApprovalStatus = OwnerRequestCards.OwnerRequestOutcome | "waiting";

export class MajordomeApprovals extends Context.Service<
  MajordomeApprovals,
  {
    /**
     * Shows the owner the card and waits. `waiting` means no answer yet: the question stays open
     * and the same call (same conversation, title and detail) joins it again. An answer given
     * while no call was waiting is heard by the next one, once.
     */
    readonly request: (input: {
      readonly threadId: ThreadId;
      /** What the agent wants to do, read after "Majordome wants to:". */
      readonly title: string;
      /** What that means for the owner, in plain words. */
      readonly detail: string;
    }) => Effect.Effect<ApprovalStatus, MajordomeApprovalError>;
    readonly getRequest: (input: MajordomeApprovalInput) => Effect.Effect<MajordomeApproval | null>;
    readonly answer: (
      input: MajordomeAnswerApprovalInput,
    ) => Effect.Effect<void, MajordomeApprovalError>;
    /** Follows runs, so a run that ends takes its open questions with it. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/majordome/MajordomeApprovals") {}

export const make = Effect.gen(function* () {
  /** Yes or no given while no call was waiting, kept for the run's next call. */
  const answered = new Map<
    string,
    { readonly runId: RunId; readonly outcome: "allowed" | "denied" }
  >();
  const answerKey = (runId: RunId, title: string, detail: string) =>
    `${runId}\u0000${title}\u0000${detail}`;

  const requests = yield* OwnerRequestCards.make<MajordomeApproval>({
    delivery: "approval",
    kind: "approval",
    beforeClose: (entry, outcome) =>
      Effect.sync(() => {
        if (outcome !== "allowed" && outcome !== "denied") return;
        answered.set(answerKey(entry.runId, entry.request.title, entry.request.detail), {
          runId: entry.runId,
          outcome,
        });
      }),
  });
  const unavailable = (error: OwnerRequestCards.OwnerRequestUnavailable) =>
    new MajordomeApprovalError({ reason: error.reason, cause: error.cause });

  const request: MajordomeApprovals["Service"]["request"] = Effect.fn("MajordomeApprovals.request")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId });
      const title = input.title.trim();
      const detail = input.detail.trim();
      const run = yield* requests.activeRun(input.threadId).pipe(Effect.mapError(unavailable));
      const key = answerKey(run.runId, title, detail);
      const earlier = answered.get(key);
      if (earlier !== undefined) {
        answered.delete(key);
        return earlier.outcome;
      }
      const entry =
        requests.find(
          (candidate) =>
            candidate.runId === run.runId &&
            candidate.request.title === title &&
            candidate.request.detail === detail,
        ) ??
        (yield* requests
          .open({
            threadId: input.threadId,
            runId: run.runId,
            nodeId: run.nodeId,
            label: title,
            reason: detail,
            pushBody: `Majordome wants to: ${title}`,
            request: (card) => ({
              threadId: input.threadId,
              title,
              detail,
              threadTitle: run.threadTitle,
              ...card,
            }),
          })
          .pipe(Effect.mapError(unavailable)));
      const outcome = yield* requests.wait(entry);
      if (Option.isNone(outcome)) return "waiting";
      answered.delete(key);
      return outcome.value;
    },
  );

  const getRequest: MajordomeApprovals["Service"]["getRequest"] = (input) =>
    Effect.sync(() => requests.get(input)?.request ?? null);

  const answer: MajordomeApprovals["Service"]["answer"] = Effect.fn("MajordomeApprovals.answer")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({
        "orchestration_v2.thread_id": input.threadId,
        "approval.allow": input.allow,
      });
      if (requests.get(input) === undefined) {
        yield* requests.closeStaleCard(input).pipe(Effect.ignore);
        return yield* new MajordomeApprovalError({ reason: "request_closed" });
      }
      yield* requests.settle(input.turnItemId, input.allow ? "allowed" : "denied");
    },
  );

  const start: MajordomeApprovals["Service"]["start"] = Effect.fn("MajordomeApprovals.start")(
    function* () {
      yield* requests.followRuns((runId) =>
        Effect.sync(() => {
          for (const [key, value] of answered) if (value.runId === runId) answered.delete(key);
        }),
      );
    },
  );

  return MajordomeApprovals.of({ request, getRequest, answer, start });
});

export const layer = Layer.effect(MajordomeApprovals, make);
