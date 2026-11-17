import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MajordomeApprovalError,
  MajordomeTopicsError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as MajordomeSettings from "../../../majordome/MajordomeSettings.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as MajordomeSettingsHandlers from "./handlers.ts";
import { MajordomeSettingsToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:assistant");
const status: MajordomeSettings.MajordomeStatus = {
  notesFolder: true,
  backup: null,
  connections: [],
  routines: null,
  topics: [{ id: "taxes", title: "Taxes", folder: "admin/taxes" }],
  privateDocuments: ["Passport"],
  notifications: { devices: [] },
};

it.effect(
  "reads and changes settings for the calling conversation, and says plainly what happened",
  () =>
    Effect.gen(function* () {
      const asked: Array<unknown> = [];
      let next: MajordomeSettings.SettingChangeResult | MajordomeSettings.MajordomeSettingsError = {
        status: "done",
        what: "Remove the topic “Taxes”",
      };
      const layerDependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:home"),
          requestNamespace: "provider:assistant",
          thread: {
            threadId,
            providerSessionId: "provider:assistant",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
        }),
        Layer.mock(MajordomeSettings.MajordomeSettings)({
          status: (input) => {
            asked.push(input);
            return Effect.succeed(status);
          },
          change: (input) => {
            asked.push(input);
            return "status" in next ? Effect.succeed(next) : Effect.fail(next);
          },
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* MajordomeSettingsToolkit;
        const result = <Name extends "get_majordome_status" | "change_majordome_setting">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );
        const change = { type: "remove_topic", topicId: "taxes" } as const;
        const remove = result("change_majordome_setting", { change });

        expect(yield* result("get_majordome_status", {})).toEqual(status);
        expect(yield* remove).toEqual({
          status: "done",
          message: "Done: Remove the topic “Taxes”.",
        });
        expect(asked).toEqual([{ threadId }, { threadId, change }]);

        for (const answer of ["denied", "timed_out", "cancelled", "waiting"] as const) {
          next = { status: answer };
          expect(yield* remove).toEqual({
            status: answer,
            message: MajordomeSettingsHandlers.SETTING_CHANGE_NOTES[answer],
          });
        }

        next = { status: "not_possible", why: "Only the owner can sign in to GitHub." };
        expect(yield* remove).toEqual({
          status: "not_possible",
          message: "Only the owner can sign in to GitHub.",
        });

        next = new MajordomeTopicsError({ message: "Could not remove this topic." });
        expect(yield* remove).toMatchObject({
          code: "orchestration_error",
          message: "Could not remove this topic.",
        });
        next = new MajordomeApprovalError({ reason: "agent_stopped" });
        expect(yield* remove).toMatchObject({ code: "parent_not_active" });
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(MajordomeSettingsHandlers.layer).pipe(
            Layer.provideMerge(layerDependencies),
          ),
        ),
      );
    }),
);
