import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as AgentNotify from "../../../majordome/AgentNotify.ts";
import * as MajordomePush from "../../../majordome/MajordomePush.ts";
import type { VaultPushMessage } from "../../../majordome/pushDecision.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as NotifyHandlers from "./handlers.ts";
import { NotifyToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:notify");
const threadId = ThreadId.make("thread:notify");

it.effect(
  "sends the user's devices a notification that opens the thread, once per 30 seconds",
  () =>
    Effect.gen(function* () {
      const sent: Array<VaultPushMessage> = [];
      let devices = 2;
      const layerDependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId,
          requestNamespace: "provider:notify",
          thread: {
            threadId,
            providerSessionId: "provider:notify",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
        }),
        AgentNotify.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(MajordomePush.MajordomePush)({
                notifyAll: (message) =>
                  Effect.sync(() => {
                    sent.push(message);
                    return devices;
                  }),
              }),
              Layer.mock(ServerEnvironment.ServerEnvironment)({
                getEnvironmentId: Effect.succeed(environmentId),
              }),
            ),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* NotifyToolkit;
        const call = (params: Parameters<typeof toolkit.handle<"notify_me">>[1]) =>
          toolkit.handle("notify_me", params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );

        expect(yield* call({ title: "Build", message: " The build passed. " })).toEqual({
          sentTo: 2,
          message: "Sent to 2 devices.",
        });
        expect(sent).toEqual([
          {
            title: "Build",
            body: "The build passed.",
            tag: "majordome:agent:thread:notify",
            url: "/threads/environment%3Anotify/thread%3Anotify",
          },
        ]);

        yield* TestClock.adjust("10 seconds");
        expect(yield* call({ message: "Again" })).toMatchObject({
          code: "invalid_request",
          message: expect.stringContaining("Wait 20s"),
        });
        expect(sent).toHaveLength(1);

        yield* TestClock.adjust("20 seconds");
        devices = 0;
        expect(yield* call({ message: "Done" })).toEqual({
          sentTo: 0,
          message:
            "No device has notifications turned on. The user can turn them on in Notifications.",
        });
        expect(sent.at(-1)?.title).toBe("Majordome");
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(NotifyHandlers.layer).pipe(
            Layer.provideMerge(layerDependencies),
          ),
        ),
      );
    }),
);
