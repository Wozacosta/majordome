import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as SavedKeysHandlers from "./handlers.ts";
import { SavedKeysToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:runs");

it.effect(
  "tells the agent names and what each is for, never a value, and saves what it is given",
  () =>
    Effect.gen(function* () {
      const saved: Array<unknown> = [];
      const layerDependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:home"),
          requestNamespace: "provider:runs",
          thread: {
            threadId,
            providerSessionId: "provider:runs",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
        }),
        Layer.mock(MajordomeSavedKeys.MajordomeSavedKeys)({
          list: () =>
            Effect.succeed({
              keys: [
                { name: "garmin", note: "Garmin token", lastUsedAt: "2026-11-20T10:00:00.000Z" },
              ],
            }),
          use: ({ name }) =>
            Effect.succeed(
              name === "garmin" ? Option.some({ file: "/state/secrets/files/abc" }) : Option.none(),
            ),
          save: (input) => {
            saved.push(input);
            return Effect.succeed({ name: input.name, note: input.note ?? "" });
          },
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* SavedKeysToolkit;
        const result = <Name extends "list_saved_keys" | "use_saved_key" | "save_key">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );

        expect(yield* result("list_saved_keys", {})).toEqual({
          keys: [{ name: "garmin", note: "Garmin token" }],
        });
        expect(yield* result("use_saved_key", { name: "garmin" })).toMatchObject({
          status: "ready",
          file: "/state/secrets/files/abc",
        });
        expect(yield* result("use_saved_key", { name: "strava" })).toEqual({
          status: "unknown_key",
          note: "No saved key has that name. Names: garmin.",
        });

        expect(
          yield* result("save_key", { name: "strava", note: "Rides", value: "stv_1" }),
        ).toMatchObject({ status: "saved" });
        yield* result("save_key", { name: "hue", note: "", file: "/state/secrets/files/def" });
        expect(saved).toEqual([
          { name: "strava", note: "Rides", value: "stv_1" },
          { name: "hue", note: "", file: "/state/secrets/files/def" },
        ]);
        // Neither a value nor a file: nothing is saved.
        expect(yield* result("save_key", { name: "empty", note: "" })).toMatchObject({
          code: "invalid_request",
        });
        expect(saved).toHaveLength(2);
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(SavedKeysHandlers.layer).pipe(
            Layer.provideMerge(layerDependencies),
          ),
        ),
      );
    }),
);
