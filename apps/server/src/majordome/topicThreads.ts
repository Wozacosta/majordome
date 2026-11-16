/**
 * This server's side of topics: which of its threads holds each topic's conversation, and whether
 * the owner has dealt with the first-topic suggestions. Kept in the state directory, not the vault,
 * since thread ids mean nothing on another server.
 */

import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const ProjectTopicState = Schema.Struct({
  /** Topic id → thread id. */
  threads: Schema.Record(Schema.String, ThreadId),
  suggestionsDismissed: Schema.optional(Schema.Boolean),
  /** The conversation behind the Routines screen. */
  routinesThread: Schema.optional(ThreadId),
});
export type ProjectTopicState = typeof ProjectTopicState.Type;

const TopicThreadsState = Schema.Struct({
  projects: Schema.Record(Schema.String, ProjectTopicState),
});
export type TopicThreadsState = typeof TopicThreadsState.Type;

const TopicThreadsStateJson = Schema.fromJsonString(TopicThreadsState);
const decodeState = Schema.decodeUnknownOption(TopicThreadsStateJson);
const encodeState = Schema.encodeSync(TopicThreadsStateJson);

export const EMPTY_PROJECT_TOPIC_STATE: ProjectTopicState = { threads: {} };

export const topicThreadsStatePath = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "majordome", "topics.json");

/** An empty state when the file is missing or unreadable. */
export const readTopicThreadsState = Effect.fn("majordome.readTopicThreadsState")(function* (
  statePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem.readFileString(statePath).pipe(Effect.option);
  return Option.getOrElse(Option.flatMap(text, decodeState), (): TopicThreadsState => ({
    projects: {},
  }));
});

export const writeTopicThreadsState = Effect.fn("majordome.writeTopicThreadsState")(function* (
  statePath: string,
  state: TopicThreadsState,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  yield* fileSystem.writeFileString(temporary, encodeState(state));
  yield* fileSystem.rename(temporary, statePath);
});

/** The topic whose conversation `threadId` holds, if any. */
export function findThreadTopic(
  state: TopicThreadsState,
  threadId: string,
): { readonly projectId: string; readonly topicId: string } | undefined {
  for (const [projectId, project] of Object.entries(state.projects)) {
    for (const [topicId, candidate] of Object.entries(project.threads)) {
      if (candidate === threadId) return { projectId, topicId };
    }
  }
  return undefined;
}
