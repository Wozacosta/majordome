import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";
import { readChatSetup } from "../../../majordome/chatSetup.ts";
import { rememberDrawnPage, renderChatSetupPage } from "../../../majordome/chatSetupPage.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { ChatSetupToolkit } from "./tools.ts";

const handlers = {
  describe_setup: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      if (caller === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "describe_setup describes the chat that calls it: call it from a chat.",
        });
      }
      const { facts: setup, opened } = yield* readChatSetup(caller);
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { html, height } = renderChatSetupPage({
        setup,
        opened,
        tools: input.tools,
        words: input.words,
      });
      // One page per chat, drawn again at each ask.
      const folder = path.join(stateDir, "majordome", "setup-pages");
      const file = path.join(folder, `${caller.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}.html`);
      yield* fileSystem.makeDirectory(folder, { recursive: true }).pipe(
        Effect.andThen(fileSystem.writeFileString(file, html)),
        Effect.mapError(
          (cause) =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: `The drawing could not be written: ${cause.message}`,
            }),
        ),
      );
      rememberDrawnPage(file);
      return {
        ...setup,
        page: { path: file, title: setup.startsWith.topic?.title ?? "This chat", height },
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ChatSetupToolkit.tools>;

export const layer = McpToolAccess.toLayer(ChatSetupToolkit, handlers);
