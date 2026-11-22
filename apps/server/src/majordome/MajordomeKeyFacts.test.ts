import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as MajordomeKeyFacts from "./MajordomeKeyFacts.ts";

const threadId = ThreadId.make("chat");

const setUp = Effect.gen(function* () {
  const state = {
    /** The conversation's messages, oldest first. */
    messages: [] as Array<{ readonly author: "owner" | "assistant"; readonly text: string }>,
    running: false,
    /** What the model answers; null makes it fail. */
    answer: "none" as string | null,
    prompts: [] as Array<string>,
  };
  const service = yield* Effect.service(MajordomeKeyFacts.MajordomeKeyFacts).pipe(
    Effect.provide(
      MajordomeKeyFacts.layer.pipe(
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () =>
              Effect.succeed({
                projectId: ProjectId.make("vault"),
                activeRunId: state.running ? "run" : null,
              } as never),
            getTimelinePage: (_threadId, options) =>
              Effect.succeed({
                items: state.messages
                  .map((message, position) => ({
                    position,
                    visibility: "local",
                    sourceThreadId: threadId,
                    sourceItemId: `item-${position}`,
                    item:
                      message.author === "owner"
                        ? { type: "user_message", createdBy: "user", text: message.text }
                        : { type: "assistant_message", text: message.text },
                  }))
                  .filter((item) => item.position > (options.afterPosition ?? -1)),
                totalItems: state.messages.length,
                hasMore: false,
                hasEarlier: false,
              } as never),
          }),
        ),
        Layer.provide(
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          }),
        ),
        Layer.provide(
          Layer.mock(TextGeneration.TextGeneration)({
            generateTranscriptionPostProcessing: (input) => {
              state.prompts.push(input.prompt);
              return state.answer === null
                ? Effect.fail(
                    new TextGenerationError({
                      operation: "generateTranscriptionPostProcessing",
                      detail: "No provider instance registered.",
                    }),
                  )
                : Effect.succeed({ transcription: state.answer });
            },
          }),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-key-facts-" })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
  return { service, state };
});

it.layer(NodeServices.layer)("MajordomeKeyFacts", (it) => {
  it.effect("reads each stretch of a conversation once and keeps what it found", () =>
    Effect.gen(function* () {
      const { service, state } = yield* setUp;
      assert.deepEqual(yield* service.read({ threadId }), { facts: [] });
      assert.lengthOf(state.prompts, 0);

      state.messages.push({ author: "owner", text: "My accountant is Claire Dupont." });
      state.running = true;
      // A reply is still being written: nothing is read yet.
      assert.deepEqual(yield* service.read({ threadId }), { facts: [] });
      assert.lengthOf(state.prompts, 0);

      state.messages.push({ author: "assistant", text: "Noted." });
      state.running = false;
      state.answer = "person | Claire Dupont | accountant";
      const claire = { kind: "person", value: "Claire Dupont", note: "accountant" } as const;
      assert.deepEqual(yield* service.read({ threadId }), { facts: [claire] });
      // Nothing new: the facts are served as kept, without asking again.
      assert.deepEqual(yield* service.read({ threadId }), { facts: [claire] });
      assert.lengthOf(state.prompts, 1);

      state.messages.push({ author: "owner", text: "We meet at 14 rue Oberkampf." });
      state.answer = "place | 14 rue Oberkampf";
      const result = yield* service.read({ threadId });
      assert.deepEqual(result.facts, [claire, { kind: "place", value: "14 rue Oberkampf" }]);
      assert.lengthOf(state.prompts, 2);
      // The second pass is given the new message only, and what is already listed.
      assert.notInclude(state.prompts[1], "My accountant is");
      assert.include(state.prompts[1], "person | Claire Dupont | accountant");
    }),
  );

  it.effect("keeps what it had, and tries the same messages again, when the pass fails", () =>
    Effect.gen(function* () {
      const { service, state } = yield* setUp;
      state.messages.push({ author: "owner", text: "Call Karim." });
      state.answer = null;
      assert.deepEqual(yield* service.read({ threadId }), { facts: [] });
      state.answer = "person | Karim";
      assert.deepEqual(yield* service.read({ threadId }), {
        facts: [{ kind: "person", value: "Karim" }],
      });
    }),
  );
});
