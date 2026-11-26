import { type MajordomeSavedKeysError, OrchestratorMcpFailure } from "@t3tools/contracts";
import { savedKeyStanding } from "@t3tools/shared/majordomeSavedKeys";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SavedKeysToolkit } from "./tools.ts";

/** What the agent reads with each answer. Model-facing: evals/mcp-tool-use covers it. */
const SAVED_KEY_NOTES = {
  ready:
    "Read the file only inside the command that needs the key. Never print it, say it in chat or write it in the notes folder.",
  saved:
    "Saved on this computer. The owner sees it in Settings, Passwords and keys, and can remove it there.",
  dated: "Saved the day it stops working. Near that day you are told when you take the key.",
} as const;

/**
 * What the agent is told when no key is saved here. Each of the owner's computers keeps its own
 * keys, so it names this one: "no keys at all" was wrong when the key sat on another.
 */
const noKeysNote = Effect.map(
  Effect.flatMap(ServerEnvironment.ServerEnvironment, (environment) => environment.getDescriptor),
  ({ label }) =>
    `No keys are saved on ${label}, the computer this conversation runs on. A key the owner saved on another of their computers cannot be used from here: they save it again in Settings, Passwords and keys, or hand it to you and you keep it with \`save_key\`.`,
);

/** What the agent is told about a key near or past its last day; empty for any other key. */
const endingNote = (expiresOn: string | undefined, nowMs: number) => {
  const standing = savedKeyStanding(expiresOn === undefined ? {} : { expiresOn }, nowMs);
  return standing === "over"
    ? ` The owner said this key stopped working after ${expiresOn}. If the service refuses it, tell them to make a new one and save it again.`
    : standing === "soon"
      ? ` The owner said this key stops working after ${expiresOn}. Tell them it needs renewing soon.`
      : "";
};

const toFailure = (error: MajordomeSavedKeysError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const handlers = {
  list_saved_keys: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { keys } = yield* (yield* MajordomeSavedKeys.MajordomeSavedKeys)
        .list()
        .pipe(Effect.mapError(toFailure));
      // A key that signs Majordome in to a source is not the agent's to use.
      const usable = keys.filter((key) => key.signsInTo === undefined);
      return {
        keys: usable.map(({ name, note, expiresOn }) => ({
          name,
          note,
          ...(expiresOn === undefined ? {} : { expires: expiresOn }),
        })),
        ...(usable.length === 0 ? { note: yield* noKeysNote } : {}),
      };
    }),
  ),
  use_saved_key: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const savedKeys = yield* MajordomeSavedKeys.MajordomeSavedKeys;
      const taken = yield* savedKeys.use({ name: input.name }).pipe(Effect.mapError(toFailure));
      const { keys } = yield* savedKeys.list().pipe(Effect.mapError(toFailure));
      if (Option.isSome(taken)) {
        const expiresOn = keys.find((key) => key.name === input.name)?.expiresOn;
        return {
          status: "ready" as const,
          file: taken.value.file,
          note: SAVED_KEY_NOTES.ready + endingNote(expiresOn, yield* Clock.currentTimeMillis),
        };
      }
      return {
        status: "unknown_key" as const,
        note:
          keys.length === 0
            ? yield* noKeysNote
            : `No saved key has that name. Names: ${keys.map((key) => key.name).join(", ")}.`,
      };
    }),
  ),
  save_key: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const source =
        input.value !== undefined
          ? { value: input.value }
          : input.file !== undefined
            ? { file: input.file }
            : undefined;
      const savedKeys = yield* MajordomeSavedKeys.MajordomeSavedKeys;
      if (source === undefined) {
        if (input.expires === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Pass the pasted `value`, or the `file` from `request_secret`.",
          });
        }
        yield* savedKeys
          .setExpiry({ name: input.name, expiresOn: input.expires })
          .pipe(Effect.mapError(toFailure));
        return { status: "saved" as const, note: SAVED_KEY_NOTES.dated };
      }
      yield* savedKeys
        .save({
          name: input.name,
          note: input.note,
          ...(input.expires === undefined ? {} : { expiresOn: input.expires }),
          ...source,
        })
        .pipe(Effect.mapError(toFailure));
      return { status: "saved" as const, note: SAVED_KEY_NOTES.saved };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof SavedKeysToolkit.tools>;

export const layer = McpToolAccess.toLayer(SavedKeysToolkit, handlers);
