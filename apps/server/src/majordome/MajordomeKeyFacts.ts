/**
 * The key facts of each conversation and the conversation in short, kept in this server's state
 * directory: a pass over the messages that arrived since the last one, run when they are read and
 * the conversation has moved on. A drawing of it is made only when asked for. Nothing is written
 * to the vault or the conversation.
 */

import {
  MajordomeDrawConversationError,
  type MajordomeDrawConversationInput,
  type MajordomeDrawConversationResult,
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
  buildDiagramPrompt,
  buildKeyFactsPrompt,
  type KeyFactsMessage,
  keyFactsTranscript,
  mergeKeyFacts,
  parseDiagram,
  parseInShort,
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
    /** Draws the conversation anew from its latest messages and keeps the drawing. */
    readonly draw: (
      input: MajordomeDrawConversationInput,
    ) => Effect.Effect<MajordomeDrawConversationResult, MajordomeDrawConversationError>;
  }
>()("t3/majordome/MajordomeKeyFacts") {}

const KeyFactsState = Schema.Struct({
  /** The timeline position of the last message a pass has read. */
  position: Schema.Number,
  facts: Schema.Array(MajordomeKeyFact),
  summary: Schema.Array(Schema.String),
  diagram: Schema.NullOr(Schema.String),
});
type KeyFactsState = typeof KeyFactsState.Type;
const KeyFactsStateJson = Schema.fromJsonString(KeyFactsState);
const decodeState = Schema.decodeUnknownOption(KeyFactsStateJson);
const encodeState = Schema.encodeSync(KeyFactsStateJson);

const NOTHING_READ: KeyFactsState = { position: -1, facts: [], summary: [], diagram: null };
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

  /** The owner's and the assistant's messages on one page of the timeline, and where it ends. */
  const messagesOf = Effect.fn("MajordomeKeyFacts.messagesOf")(function* (
    threadId: ThreadId,
    bound: { readonly afterPosition: number } | { readonly beforePosition: number },
  ) {
    const page = yield* threads.getTimelinePage(threadId, {
      ...bound,
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
      const { messages, end, hasMore } = yield* messagesOf(threadId, {
        afterPosition: state.position,
      });
      if (end === undefined) break;
      const transcript = keyFactsTranscript(messages);
      let { facts, summary } = state;
      if (transcript !== "") {
        // Providers run in a working directory; this one must not read or change the notes.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-key-facts-" });
        // The one text-generation operation that takes a prompt as it is.
        const generated = yield* textGeneration.generateTranscriptionPostProcessing({
          cwd,
          prompt: buildKeyFactsPrompt({
            today: yield* DateTime.now,
            known: state.facts,
            summary: state.summary,
            transcript,
          }),
          modelSelection: resolveProjectSettings(yield* settings.getSettings, shell.projectId)
            .settings.textGenerationModelSelection,
        });
        facts = mergeKeyFacts(state.facts, parseKeyFacts(generated.transcription, transcript));
        const rewritten = parseInShort(generated.transcription);
        if (rewritten.length > 0) summary = rewritten;
      }
      state = { position: end, facts, summary, diagram: state.diagram };
      yield* writeState(threadId, state);
      if (!hasMore) break;
    }
    return state;
  });

  const lockOf = Effect.fn("MajordomeKeyFacts.lockOf")(function* (threadId: ThreadId) {
    const lock = locks.get(threadId) ?? (yield* Semaphore.make(1));
    locks.set(threadId, lock);
    return lock;
  });

  const read: MajordomeKeyFacts["Service"]["read"] = Effect.fn("MajordomeKeyFacts.read")(
    function* (input) {
      const lock = yield* lockOf(input.threadId);
      const caughtUp = yield* catchUp(input.threadId).pipe(
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
      const state = caughtUp ?? (yield* readState(input.threadId));
      return { facts: state.facts, summary: state.summary, diagram: state.diagram };
    },
  );

  const drawNow = Effect.fn("MajordomeKeyFacts.drawNow")(function* (threadId: ThreadId) {
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null) return null;
    const { messages } = yield* messagesOf(threadId, {
      beforePosition: Number.POSITIVE_INFINITY,
    });
    const transcript = keyFactsTranscript(messages);
    if (transcript === "") return null;
    const state = yield* readState(threadId);
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-key-facts-" });
    const generated = yield* textGeneration.generateTranscriptionPostProcessing({
      cwd,
      prompt: buildDiagramPrompt({ summary: state.summary, transcript }),
      modelSelection: resolveProjectSettings(yield* settings.getSettings, shell.projectId).settings
        .textGenerationModelSelection,
    });
    const diagram = parseDiagram(generated.transcription);
    if (diagram !== null) yield* writeState(threadId, { ...state, diagram });
    return diagram;
  });

  const draw: MajordomeKeyFacts["Service"]["draw"] = Effect.fn("MajordomeKeyFacts.draw")(
    function* (input) {
      const lock = yield* lockOf(input.threadId);
      const diagram = yield* drawNow(input.threadId).pipe(
        Effect.scoped,
        Effect.timeoutOption(PASS_TIMEOUT),
        Effect.map(Option.getOrNull),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logDebug("Conversation drawing failed", { cause }).pipe(Effect.as(null)),
        ),
        lock.withPermits(1),
      );
      if (diagram === null) {
        return yield* new MajordomeDrawConversationError({
          message: "The assistant could not draw this conversation. Try again in a moment.",
        });
      }
      return { diagram };
    },
  );

  return MajordomeKeyFacts.of({ read, draw });
});

export const layer = Layer.effect(MajordomeKeyFacts, make);
