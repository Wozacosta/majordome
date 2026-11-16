/**
 * What this server remembers of a vault's last memory pass: where the vault's history stood, and
 * the list of changed notes that pass was given. One file per vault in the server's state
 * directory, so a pass that finds nothing to keep leaves the vault itself untouched.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const MemoryPassState = Schema.Struct({
  /** The vault's newest commit when the pass was prepared; empty in a vault with no history. */
  head: Schema.String,
  brief: Schema.Struct({
    since: Schema.NullOr(Schema.String),
    preparedAt: Schema.String,
    files: Schema.Array(Schema.String),
    more: Schema.Number,
    memoryChars: Schema.Number,
  }),
});
export type MemoryPassState = typeof MemoryPassState.Type;
const MemoryPassStateJson = Schema.fromJsonString(MemoryPassState);
const decodeState = Schema.decodeUnknownOption(MemoryPassStateJson);
const encodeState = Schema.encodeSync(MemoryPassStateJson);

interface StateKey {
  readonly stateDir: string;
  readonly projectId: string;
}

const statePath = (path: Path.Path, key: StateKey) =>
  path.join(key.stateDir, "majordome", "memory-pass", `${encodeURIComponent(key.projectId)}.json`);

export const readMemoryPassState = Effect.fn("majordome.readMemoryPassState")(function* (
  key: StateKey,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem.readFileString(statePath(path, key)).pipe(Effect.option);
  return Option.flatMap(text, decodeState);
});

/** The list the last scheduled pass was given, for that pass's own conversation. */
export const readMemoryPassBrief = Effect.fn("majordome.readMemoryPassBrief")(function* (
  key: StateKey,
) {
  return Option.map(yield* readMemoryPassState(key), (state) => state.brief);
});

export const writeMemoryPassState = Effect.fn("majordome.writeMemoryPassState")(function* (
  key: StateKey,
  state: MemoryPassState,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = statePath(path, key);
  yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  yield* fileSystem.writeFileString(temporary, encodeState(state));
  yield* fileSystem.rename(temporary, file);
});
