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
      const nothing = { facts: [], summary: [], diagram: null };
      assert.deepEqual(yield* service.read({ threadId }), nothing);
      assert.lengthOf(state.prompts, 0);

      state.messages.push({ author: "owner", text: "My accountant is Claire Dupont." });
      state.running = true;
      // A reply is still being written: nothing is read yet.
      assert.deepEqual(yield* service.read({ threadId }), nothing);
      assert.lengthOf(state.prompts, 0);

      state.messages.push({ author: "assistant", text: "Noted." });
      state.running = false;
      state.answer = "person | Claire Dupont | accountant\nshort | Named the accountant.";
      const claire = { kind: "person", value: "Claire Dupont", note: "accountant" } as const;
      const first = { facts: [claire], summary: ["Named the accountant."], diagram: null };
      assert.deepEqual(yield* service.read({ threadId }), first);
      // Nothing new: what was found is served as kept, without asking again.
      assert.deepEqual(yield* service.read({ threadId }), first);
      assert.lengthOf(state.prompts, 1);

      state.messages.push({ author: "owner", text: "We meet at 14 rue Oberkampf." });
      state.answer = "place | 14 rue Oberkampf";
      const result = yield* service.read({ threadId });
      assert.deepEqual(result.facts, [claire, { kind: "place", value: "14 rue Oberkampf" }]);
      // A pass that rewrites nothing leaves the short version as it was.
      assert.deepEqual(result.summary, ["Named the accountant."]);
      assert.lengthOf(state.prompts, 2);
      // The second pass is given the new message only, and what is already known.
      assert.notInclude(state.prompts[1], "My accountant is");
      assert.include(state.prompts[1], "person | Claire Dupont | accountant");
      assert.include(state.prompts[1], "<in_short_so_far>\nNamed the accountant.");
    }),
  );

  it.effect("draws the whole conversation when asked, and keeps the drawing", () =>
    Effect.gen(function* () {
      const { service, state } = yield* setUp;
      state.messages.push(
        { author: "owner", text: "Should I renew the lease or move?" },
        { author: "assistant", text: "Renew if the rent stays, otherwise move." },
      );
      state.answer = "short | Deciding on the lease.";
      yield* service.read({ threadId });

      state.answer = "no drawing here";
      const failed = yield* Effect.flip(service.draw({ threadId }));
      assert.include(failed.message, "could not draw");

      state.answer = "box | A | Lease ends\nbox | B | Renew\narrow | A | B | rent stays";
      const { diagram } = yield* service.draw({ threadId });
      assert.include(diagram, 'n0 -->|"rent stays"| n1');
      assert.include(state.prompts.at(-1), "owner: Should I renew the lease or move?");
      assert.deepEqual(yield* service.read({ threadId }), {
        facts: [],
        summary: ["Deciding on the lease."],
        diagram,
      });
    }),
  );

  it.effect("keeps what it had, and tries the same messages again, when the pass fails", () =>
    Effect.gen(function* () {
      const { service, state } = yield* setUp;
      state.messages.push({ author: "owner", text: "Call Karim." });
      state.answer = null;
      assert.deepEqual((yield* service.read({ threadId })).facts, []);
      state.answer = "person | Karim";
      assert.deepEqual((yield* service.read({ threadId })).facts, [
        { kind: "person", value: "Karim" },
      ]);
    }),
  );
});
