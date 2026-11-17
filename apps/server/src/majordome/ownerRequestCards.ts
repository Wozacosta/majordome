/**
 * A question only the owner can answer, asked by an agent's run: a card in its conversation (the
 * secret request card, told apart by `delivery`), a push, and a wait. The run is "waiting for you"
 * in the feed and its time limit pauses. No answer in 24 hours closes it, and so does the run
 * ending. Private document requests and setting approvals each keep their own set.
 */

import { CommandId, type NodeId, type RunId, type ThreadId, TurnItemId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as MajordomePush from "./MajordomePush.ts";

/** A request nobody answers is closed after this long. */
const REQUEST_TIMEOUT = Duration.hours(24);
/** One wait lasts this long, under the 65 minutes providers give an MCP tool call. */
const REQUEST_WAIT = Duration.minutes(60);

export type OwnerRequestOutcome = "allowed" | "denied" | "timed_out" | "cancelled";

/** Why a conversation cannot ask right now. Each service maps it to its own error. */
export class OwnerRequestUnavailable extends Schema.TaggedError<OwnerRequestUnavailable>()(
  "OwnerRequestUnavailable",
  {
    reason: Schema.Literals(["thread_unavailable", "agent_stopped"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "agent_stopped"
      ? "The run that would ask has ended."
      : "The conversation could not be read.";
  }
}

interface CardRef {
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
}

export interface OwnerRequest<Request extends CardRef> {
  readonly request: Request;
  readonly runId: RunId;
  readonly nodeId: NodeId;
  /** The card's two lines. */
  readonly label: string;
  readonly reason: string;
  readonly settled: Deferred.Deferred<OwnerRequestOutcome>;
}

export const make = Effect.fn("ownerRequestCards.make")(function* <
  Request extends CardRef,
>(options: {
  readonly delivery: "private_document" | "approval";
  /** Names this kind of request in its command and turn item ids. */
  readonly kind: string;
  /** Runs as a request closes, before its card changes and its waiter hears. */
  readonly beforeClose?: (
    entry: OwnerRequest<Request>,
    outcome: OwnerRequestOutcome,
  ) => Effect.Effect<void>;
}) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const push = yield* MajordomePush.MajordomePush;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const random = yield* SecureRandom.SecureRandom;
  const serviceScope = yield* Effect.scope;

  const pending = new Map<TurnItemId, OwnerRequest<Request>>();

  const record = (
    entry: OwnerRequest<Request>,
    secretStatus: "pending" | "saved" | "declined" | "cancelled",
  ) =>
    threads.dispatch({
      type: "secret_request.record",
      commandId: CommandId.make(`${options.kind}:${entry.request.turnItemId}:${secretStatus}`),
      threadId: entry.request.threadId,
      runId: entry.runId,
      nodeId: entry.nodeId,
      turnItemId: entry.request.turnItemId,
      label: entry.label,
      reason: entry.reason,
      delivery: options.delivery,
      secretStatus,
    });

  /** Closes a request that was already taken out of the pending set. */
  const finish = Effect.fn("ownerRequestCards.finish")(function* (
    entry: OwnerRequest<Request>,
    outcome: OwnerRequestOutcome,
  ) {
    if (options.beforeClose !== undefined) yield* options.beforeClose(entry, outcome);
    yield* record(
      entry,
      outcome === "allowed" ? "saved" : outcome === "denied" ? "declined" : "cancelled",
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Majordome could not close a request card.", {
          kind: options.kind,
          cause,
        }),
      ),
    );
    yield* Deferred.succeed(entry.settled, outcome);
  }, Effect.uninterruptible);

  const settle = (turnItemId: TurnItemId, outcome: OwnerRequestOutcome) =>
    Effect.suspend(() => {
      const entry = pending.get(turnItemId);
      if (entry === undefined) return Effect.void;
      pending.delete(turnItemId);
      return finish(entry, outcome);
    });

  /** The run a request would wait in, or why the conversation cannot ask right now. */
  const activeRun = Effect.fn("ownerRequestCards.activeRun")(function* (threadId: ThreadId) {
    const records = yield* threads
      .getThreadRecords(threadId, ["runs"])
      .pipe(
        Effect.mapError(
          (cause) => new OwnerRequestUnavailable({ reason: "thread_unavailable", cause }),
        ),
      );
    const run = ThreadManagement.latestActiveRun(records);
    if (run === undefined || run.rootNodeId === null) {
      return yield* new OwnerRequestUnavailable({ reason: "agent_stopped" });
    }
    return {
      runId: run.id,
      nodeId: run.rootNodeId,
      threadTitle: records.thread.title.trim() || "A conversation",
    };
  });

  /** Shows the card, starts its 24 hours and sends the push. */
  const open = Effect.fn("ownerRequestCards.open")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly nodeId: NodeId;
    readonly label: string;
    readonly reason: string;
    readonly pushBody: string;
    readonly request: (card: {
      readonly turnItemId: TurnItemId;
      readonly requestedAt: string;
      readonly expiresAt: string;
    }) => Request;
  }) {
    const now = yield* DateTime.now;
    const id = yield* random.randomBytes(16).pipe(Effect.map(Hex.encode));
    const turnItemId = TurnItemId.make(`turn-item:${options.kind}:${id}`);
    const entry: OwnerRequest<Request> = {
      request: input.request({
        turnItemId,
        requestedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.addDuration(now, REQUEST_TIMEOUT)),
      }),
      runId: input.runId,
      nodeId: input.nodeId,
      label: input.label,
      reason: input.reason,
      settled: yield* Deferred.make<OwnerRequestOutcome>(),
    };
    yield* record(entry, "pending").pipe(
      Effect.mapError(
        (cause) => new OwnerRequestUnavailable({ reason: "thread_unavailable", cause }),
      ),
    );
    pending.set(turnItemId, entry);
    yield* Effect.sleep(REQUEST_TIMEOUT).pipe(
      Effect.andThen(settle(turnItemId, "timed_out")),
      Effect.forkIn(serviceScope),
    );
    const environmentId = yield* environment.getEnvironmentId;
    // Delivery waits on the network; the request must not.
    yield* push
      .notifyAll({
        title: "Waiting for you",
        body: input.pushBody,
        tag: `majordome:${input.threadId}`,
        url: `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(input.threadId)}`,
      })
      .pipe(Effect.forkIn(serviceScope));
    return entry;
  });

  /** The answer, or none when this wait ran out: the request stays open to be joined again. */
  const wait = (entry: OwnerRequest<Request>) =>
    Deferred.await(entry.settled).pipe(Effect.timeoutOption(REQUEST_WAIT));

  const get = (input: CardRef) => {
    const entry = pending.get(input.turnItemId);
    return entry?.request.threadId === input.threadId ? entry : undefined;
  };

  /** Takes a request out so nothing else can close it; `restore` puts it back unanswered. */
  const take = (input: CardRef) => {
    const entry = get(input);
    if (entry !== undefined) pending.delete(input.turnItemId);
    return entry;
  };
  const restore = (entry: OwnerRequest<Request>) => {
    pending.set(entry.request.turnItemId, entry);
  };

  const find = (matches: (entry: OwnerRequest<Request>) => boolean) =>
    [...pending.values()].find(matches);

  const cancelWhere = (matches: (entry: OwnerRequest<Request>) => boolean) =>
    Effect.forEach(
      [...pending.values()].filter(matches),
      (entry) => settle(entry.request.turnItemId, "cancelled"),
      { discard: true },
    );

  /** A card left open by a server that stopped: nobody waits behind it, so close it. */
  const closeStaleCard = Effect.fn("ownerRequestCards.closeStaleCard")(function* (input: CardRef) {
    const records = yield* threads.getThreadRecords(input.threadId, ["turnItems"], {
      turnItemTypes: ["secret_request"],
      messageRoles: [],
    });
    const item = records.turnItems.find((candidate) => candidate.id === input.turnItemId);
    if (
      item?.type !== "secret_request" ||
      item.delivery !== options.delivery ||
      item.secretStatus !== "pending" ||
      item.runId === null ||
      item.nodeId === null
    ) {
      return;
    }
    yield* threads.dispatch({
      type: "secret_request.record",
      commandId: CommandId.make(`${options.kind}:${item.id}:cancelled`),
      threadId: input.threadId,
      runId: item.runId,
      nodeId: item.nodeId,
      turnItemId: item.id,
      label: item.label,
      reason: item.reason,
      delivery: options.delivery,
      secretStatus: "cancelled",
    });
  });

  /** Follows runs: one that ends takes its open requests with it, then `alsoOnEnd` runs. */
  const followRuns = Effect.fn("ownerRequestCards.followRuns")(function* (
    alsoOnEnd: (runId: RunId) => Effect.Effect<void> = () => Effect.void,
  ) {
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        event.type === "run.updated" && ThreadManagement.isTerminalRunStatus(event.payload.status)
          ? alsoOnEnd(event.payload.id).pipe(
              Effect.andThen(cancelWhere((entry) => entry.runId === event.payload.id)),
            )
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome stopped following runs for request cards.", {
            kind: options.kind,
            cause,
          }),
        ),
      ),
    );
  });

  return {
    activeRun,
    open,
    wait,
    get,
    take,
    restore,
    find,
    settle,
    finish,
    cancelWhere,
    closeStaleCard,
    followRuns,
  };
});
