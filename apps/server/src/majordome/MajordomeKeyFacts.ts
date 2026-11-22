/**
 * The key facts of each conversation, kept in this server's state directory: a pass over the
 * messages that arrived since the last one, run when the facts are read and the conversation has
 * moved on. Nothing is written to the vault or the conversation.
 */

import {
  MajordomeKeyFact,
  type MajordomeKeyFactsInput,
  type MajordomeKeyFactsResult,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  buildKeyFactsPrompt,
  type KeyFactsMessage,
  keyFactsTranscript,
  mergeKeyFacts,
  parseKeyFacts,
} from "./keyFacts.ts";

export class MajordomeKeyFacts extends Context.Service<
  MajordomeKeyFacts,
  {
    /**
     * The conversation's key facts, brought up to date first when it has new messages and no reply
     * is being written. Never fails: without a usable pass it is what was found before.
     */
    readonly read: (input: MajordomeKeyFactsInput) => Effect.Effect<MajordomeKeyFactsResult>;
  }
>()("t3/majordome/MajordomeKeyFacts") {}

const KeyFactsState = Schema.Struct({
  /** The timeline position of the last message a pass has read. */
  position: Schema.Number,
  facts: Schema.Array(MajordomeKeyFact),
});
type KeyFactsState = typeof KeyFactsState.Type;
const KeyFactsStateJson = Schema.fromJsonString(KeyFactsState);
const decodeState = Schema.decodeUnknownOption(KeyFactsStateJson);
const encodeState = Schema.encodeSync(KeyFactsStateJson);

const NOTHING_READ: KeyFactsState = { position: -1, facts: [] };
const PAGE_SIZE = 200;
/** A long conversation read for the first time is caught up over a few passes, not one. */
const MAX_PASSES = 4;
/** A provider CLI takes a few seconds to start, and the panel waits on this. */
const PASS_TIMEOUT = "90 seconds";

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // One pass per conversation at a time: a second reader waits and finds the first one's result.
  const locks = new Map<ThreadId, Semaphore.Semaphore>();

  const statePath = (threadId: ThreadId) =>
    path.join(config.stateDir, "majordome", "key-facts", `${encodeURIComponent(threadId)}.json`);

  const readState = (threadId: ThreadId) =>
    fileSystem.readFileString(statePath(threadId)).pipe(
      Effect.option,
      Effect.map((text) => Option.getOrElse(Option.flatMap(text, decodeState), () => NOTHING_READ)),
    );

  const writeState = Effect.fn("MajordomeKeyFacts.writeState")(function* (
    threadId: ThreadId,
    state: KeyFactsState,
  ) {
    const file = statePath(threadId);
    yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    yield* fileSystem.writeFileString(temporary, encodeState(state));
    yield* fileSystem.rename(temporary, file);
  });

  /** The owner's and the assistant's messages after `position`, and where that page ends. */
  const messagesAfter = Effect.fn("MajordomeKeyFacts.messagesAfter")(function* (
    threadId: ThreadId,
    position: number,
  ) {
    const page = yield* threads.getTimelinePage(threadId, {
      afterPosition: position,
      limit: PAGE_SIZE,
      view: "messages",
    });
    // A message body the timeline left out is read from the message itself.
    const omitted = new Map<ThreadId, Array<MessageId>>();
    for (const { sourceThreadId, item } of page.items) {
      if ((item.type === "user_message" || item.type === "assistant_message") && item.textOmitted) {
        omitted.set(sourceThreadId, [...(omitted.get(sourceThreadId) ?? []), item.messageId]);
      }
    }
    const bodies = new Map<MessageId, string>();
    for (const [sourceThreadId, messageIds] of omitted) {
      const found = yield* threads.getMessagesById(sourceThreadId, messageIds);
      for (const [id, message] of found) bodies.set(id, message.text);
    }
    const messages = page.items.flatMap(({ item }): ReadonlyArray<KeyFactsMessage> => {
      switch (item.type) {
        case "user_message":
          // Scheduled prompts and agents' messages are not the owner's words.
          return item.createdBy === "user"
            ? [{ author: "owner", text: bodies.get(item.messageId) ?? item.text }]
            : [];
        case "assistant_message":
          return [{ author: "assistant", text: bodies.get(item.messageId) ?? item.text }];
        default:
          return [];
      }
    });
    return { messages, end: page.items.at(-1)?.position, hasMore: page.hasMore };
  });

  const catchUp = Effect.fn("MajordomeKeyFacts.catchUp")(function* (threadId: ThreadId) {
    let state = yield* readState(threadId);
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const shell = yield* threads.getThreadShell(threadId);
      // A reply still being written is read once it is whole.
      if (shell === null || shell.activeRunId !== null) break;
      const { messages, end, hasMore } = yield* messagesAfter(threadId, state.position);
      if (end === undefined) break;
      const transcript = keyFactsTranscript(messages);
      let facts = state.facts;
      if (transcript !== "") {
        // Providers run in a working directory; this one must not read or change the notes.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-key-facts-" });
        // The one text-generation operation that takes a prompt as it is.
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildKeyFactsPrompt({
            today: yield* DateTime.now,
            known: state.facts,
            transcript,
          }),
          modelSelection: resolveProjectSettings(yield* settings.getSettings, shell.projectId)
            .settings.textGenerationModelSelection,
        });
        facts = mergeKeyFacts(state.facts, parseKeyFacts(generated.transcription, transcript));
      }
      state = { position: end, facts };
      yield* writeState(threadId, state);
      if (!hasMore) break;
    }
    return state.facts;
  });

  const read: MajordomeKeyFacts["Service"]["read"] = Effect.fn("MajordomeKeyFacts.read")(
    function* (input) {
      const lock = locks.get(input.threadId) ?? (yield* Semaphore.make(1));
      locks.set(input.threadId, lock);
      const facts = yield* catchUp(input.threadId).pipe(
        Effect.scoped,
        Effect.timeoutOption(PASS_TIMEOUT),
        Effect.map(Option.getOrUndefined),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logDebug("Key facts pass failed", { cause }).pipe(Effect.as(undefined)),
        ),
        lock.withPermits(1),
      );
      // Each page a pass finished is saved, so a pass cut short still shows what it reached.
      return { facts: facts ?? (yield* readState(input.threadId)).facts };
    },
  );

  return MajordomeKeyFacts.of({ read });
});

export const layer = Layer.effect(MajordomeKeyFacts, make);
