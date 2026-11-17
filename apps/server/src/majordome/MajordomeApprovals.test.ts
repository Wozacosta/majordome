import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as MajordomeApprovals from "./MajordomeApprovals.ts";
import * as MajordomePush from "./MajordomePush.ts";
import type { VaultPushMessage } from "./pushDecision.ts";

const threadId = ThreadId.make("thread:assistant");
const runId = RunId.make("run:assistant");
const question = {
  threadId,
  title: "Remove the topic “Fitness”",
  detail: "The topic leaves the sidebar. Its folder and notes stay.",
};

type RecordCommand = Extract<OrchestrationV2ServerCommand, { type: "secret_request.record" }>;

const startService = Effect.gen(function* () {
  const pushes = yield* Queue.unbounded<VaultPushMessage>();
  const cards = yield* Queue.unbounded<RecordCommand>();
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const state = { runStatus: "running" };
  const scope = yield* Scope.make();
  const service = yield* MajordomeApprovals.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(MajordomePush.MajordomePush)({
          notifyAll: (message) => Queue.offer(pushes, message).pipe(Effect.as(1)),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:home")),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadRecords: () =>
            Effect.succeed({
              thread: { title: "Assistant" },
              runs: [{ id: runId, status: state.runStatus, ordinal: 1, rootNodeId: "node:root" }],
              turnItems: [],
            } as never),
          dispatch: (command) =>
            command.type === "secret_request.record"
              ? Queue.offer(cards, command).pipe(Effect.as({} as never))
              : Effect.die("unexpected command"),
          streamDomainEvents: Stream.fromQueue(events),
        }),
      ),
    ),
    Scope.provide(scope),
  );
  yield* service.start().pipe(Scope.provide(scope));
  return { service, pushes, cards, events, state, stop: Scope.close(scope, Exit.void) };
});

describe("MajordomeApprovals", () => {
  it.effect.each([
    { allow: true, status: "allowed", card: "saved" },
    { allow: false, status: "denied", card: "declined" },
  ] as const)("the owner's answer on the card ends the wait: $status", ({ allow, status, card }) =>
    Effect.gen(function* () {
      const harness = yield* startService;
      const asking = yield* Effect.forkChild(harness.service.request(question));

      const push = yield* Queue.take(harness.pushes);
      assert.strictEqual(push.body, "Majordome wants to: Remove the topic “Fitness”");
      assert.strictEqual(push.url, "/threads/environment%3Ahome/thread%3Aassistant");
      const shown = yield* Queue.take(harness.cards);
      assert.deepInclude(shown, {
        label: question.title,
        reason: question.detail,
        delivery: "approval",
        secretStatus: "pending",
        runId,
      });
      const ref = { threadId, turnItemId: shown.turnItemId };
      assert.deepInclude(yield* harness.service.getRequest(ref), {
        title: question.title,
        detail: question.detail,
        threadTitle: "Assistant",
      });

      yield* harness.service.answer({ ...ref, allow });
      assert.strictEqual(yield* Fiber.join(asking), status);
      assert.deepInclude(yield* Queue.take(harness.cards), {
        turnItemId: shown.turnItemId,
        secretStatus: card,
      });
      assert.isNull(yield* harness.service.getRequest(ref));
      const again = yield* harness.service.answer({ ...ref, allow: true }).pipe(Effect.flip);
      assert.strictEqual(again.reason, "request_closed");
      yield* harness.stop;
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );

  it.effect("a call stops waiting after an hour, and the next one hears the answer once", () =>
    Effect.gen(function* () {
      const harness = yield* startService;
      const first = yield* Effect.forkChild(harness.service.request(question));
      const shown = yield* Queue.take(harness.cards);
      yield* TestClock.adjust("60 minutes");
      assert.strictEqual(yield* Fiber.join(first), "waiting");

      // The same question joins the open card instead of asking twice.
      const second = yield* Effect.forkChild(harness.service.request(question));
      yield* TestClock.adjust("60 minutes");
      assert.strictEqual(yield* Fiber.join(second), "waiting");
      yield* Queue.take(harness.pushes);
      assert.isTrue(Option.isNone(yield* Queue.poll(harness.pushes)));

      yield* harness.service.answer({ threadId, turnItemId: shown.turnItemId, allow: true });
      assert.strictEqual(yield* harness.service.request(question), "allowed");

      // That yes was for one change: asking again shows a new card.
      const third = yield* Effect.forkChild(harness.service.request(question));
      assert.strictEqual((yield* Queue.take(harness.pushes)).title, "Waiting for you");
      yield* Fiber.interrupt(third);
      yield* harness.stop;
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );

  it.effect("a question nobody answers closes after 24 hours", () =>
    Effect.gen(function* () {
      const harness = yield* startService;
      const asking = yield* Effect.forkChild(harness.service.request(question));
      const shown = yield* Queue.take(harness.cards);
      yield* TestClock.adjust("60 minutes");
      assert.strictEqual(yield* Fiber.join(asking), "waiting");

      yield* TestClock.adjust("23 hours");
      assert.deepInclude(yield* Queue.take(harness.cards), {
        turnItemId: shown.turnItemId,
        secretStatus: "cancelled",
      });
      const late = yield* harness.service
        .answer({ threadId, turnItemId: shown.turnItemId, allow: true })
        .pipe(Effect.flip);
      assert.strictEqual(late.reason, "request_closed");
      yield* harness.stop;
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );

  it.effect("a run that ends takes its open question with it", () =>
    Effect.gen(function* () {
      const harness = yield* startService;
      const asking = yield* Effect.forkChild(harness.service.request(question));
      const shown = yield* Queue.take(harness.cards);
      yield* Queue.offer(harness.events, {
        type: "run.updated",
        payload: { id: runId, status: "completed" },
      } as never);

      assert.strictEqual(yield* Fiber.join(asking), "cancelled");
      assert.deepInclude(yield* Queue.take(harness.cards), {
        turnItemId: shown.turnItemId,
        secretStatus: "cancelled",
      });

      harness.state.runStatus = "completed";
      const stopped = yield* harness.service.request(question).pipe(Effect.flip);
      assert.strictEqual(stopped.reason, "agent_stopped");
      yield* harness.stop;
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );
});
