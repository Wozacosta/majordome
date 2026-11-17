import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MajordomeSettings from "../../../majordome/MajordomeSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { MajordomeSettingsToolkit } from "./tools.ts";

/** What the agent reads when a change waited for the owner. Model-facing: evals/mcp-tool-use covers it. */
export const SETTING_CHANGE_NOTES = {
  denied:
    "The owner said no, so nothing was changed. Tell them, and don't ask again or do it another way.",
  timed_out:
    "The owner did not answer in time, so nothing was changed. Say so; ask again only if they tell you to.",
  cancelled: "The question closed before an answer, so nothing was changed.",
  waiting:
    "The owner has not answered yet, and nothing was changed. The question stays open for 24 hours: call again with the same `change` to keep waiting.",
} as const;

const toFailure = (error: MajordomeSettings.MajordomeSettingsError) =>
  new OrchestratorMcpFailure({
    code:
      error._tag === "MajordomeApprovalError" && error.reason === "agent_stopped"
        ? "parent_not_active"
        : "orchestration_error",
    message: error.message,
  });

const handlers = {
  get_majordome_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "get_majordome_status",
      );
      return yield* (yield* MajordomeSettings.MajordomeSettings).status({
        threadId: thread.threadId,
      });
    }),
  ),
  change_majordome_setting: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "change_majordome_setting",
      );
      const result = yield* (yield* MajordomeSettings.MajordomeSettings)
        .change({ threadId: thread.threadId, change: input.change })
        .pipe(Effect.mapError(toFailure));
      switch (result.status) {
        case "done":
          return { status: result.status, message: `Done: ${result.what}.` };
        case "not_possible":
          return { status: result.status, message: result.why };
        default:
          return { status: result.status, message: SETTING_CHANGE_NOTES[result.status] };
      }
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof MajordomeSettingsToolkit.tools>;

export const layer = McpToolAccess.toLayer(MajordomeSettingsToolkit, handlers);
