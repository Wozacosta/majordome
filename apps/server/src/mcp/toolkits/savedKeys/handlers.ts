import { type MajordomeSavedKeysError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SavedKeysToolkit } from "./tools.ts";

/** What the agent reads with each answer. Model-facing: evals/mcp-tool-use covers it. */
const SAVED_KEY_NOTES = {
  ready:
    "Read the file only inside the command that needs the key. Never print it, say it in chat or write it in the notes folder.",
  none: "The owner has saved no keys. They add them in Settings, Passwords and keys, or you save one with `save_key`.",
  saved:
    "Saved on this computer. The owner sees it in Settings, Passwords and keys, and can remove it there.",
} as const;

const toFailure = (error: MajordomeSavedKeysError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const handlers = {
  list_saved_keys: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { keys } = yield* (yield* MajordomeSavedKeys.MajordomeSavedKeys)
        .list()
        .pipe(Effect.mapError(toFailure));
      return { keys: keys.map(({ name, note }) => ({ name, note })) };
    }),
  ),
  use_saved_key: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const savedKeys = yield* MajordomeSavedKeys.MajordomeSavedKeys;
      const taken = yield* savedKeys.use({ name: input.name }).pipe(Effect.mapError(toFailure));
      if (Option.isSome(taken)) {
        return { status: "ready" as const, file: taken.value.file, note: SAVED_KEY_NOTES.ready };
      }
      const { keys } = yield* savedKeys.list().pipe(Effect.mapError(toFailure));
      return {
        status: "unknown_key" as const,
        note:
          keys.length === 0
            ? SAVED_KEY_NOTES.none
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
      if (source === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass the pasted `value`, or the `file` from `request_secret`.",
        });
      }
      yield* (yield* MajordomeSavedKeys.MajordomeSavedKeys)
        .save({ name: input.name, note: input.note, ...source })
        .pipe(Effect.mapError(toFailure));
      return { status: "saved" as const, note: SAVED_KEY_NOTES.saved };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof SavedKeysToolkit.tools>;

export const layer = McpToolAccess.toLayer(SavedKeysToolkit, handlers);
