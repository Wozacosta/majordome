import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readChatSetup } from "../../../majordome/chatSetup.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { ChatSetupToolkit } from "./tools.ts";

const handlers = {
  describe_setup: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      if (caller === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "describe_setup describes the chat that calls it: call it from a chat.",
        });
      }
      return yield* readChatSetup(caller);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ChatSetupToolkit.tools>;

export const layer = McpToolAccess.toLayer(ChatSetupToolkit, handlers);
