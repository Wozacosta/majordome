// @effect-diagnostics globalDate:off
/**
 * Usage cut by what it was for: a routine, a topic, the other chats, or something this server's
 * chats did not start. Nothing is recorded for it. The usage service reads the providers' own
 * session files; this says whose each session is from what the server already keeps: the session
 * a chat runs in, the turns of each chat, and the scheduled task that started a turn.
 */

import {
  type MajordomeUsageByUse,
  type MajordomeUsageUse,
  type MajordomeUsageUseKind,
  ProjectId,
  UsageReadError,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { totalTokens } from "@t3tools/provider-core/server/usage";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as UsageService from "../usage/UsageService.ts";
import { usageTimestampFilter } from "../usage/usageAggregation.ts";
import { readTopicThreadsState, topicThreadsStatePath } from "./topicThreads.ts";
import { readVaultTopics } from "./vaultTopics.ts";

/** A turn is read when it ended this long before the window at most: a session outlives its turn. */
const RUN_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/** A provider stamps its first record of a turn around when the turn starts, on its own clock. */
const RUN_START_SLACK_MS = 2_000;

interface UsageRun {
  readonly threadId: string;
  readonly startedAtMs: number;
  /** The scheduled task that started the turn; null for one the owner sent. */
  readonly scheduledTaskId: string | null;
}

interface UsageAttributionIndex {
  /** A provider's own session id → the chat that runs in it. */
  readonly sessionThreads: ReadonlyMap<string, string>;
  /** A subagent's chat → the chat that started it. */
  readonly parents: ReadonlyMap<string, string>;
  /** Each chat's turns, oldest first. */
  readonly runs: ReadonlyMap<string, ReadonlyArray<UsageRun>>;
  /** A chat → the key of its topic, for a topic's conversation and its other chats. */
  readonly threadTopics: ReadonlyMap<string, string>;
}

interface UsageUseRef {
  readonly kind: MajordomeUsageUseKind;
  /** Unique on this server: a scheduled task id, or a project and topic id. Empty otherwise. */
  readonly key: string;
}

const OUTSIDE: UsageUseRef = { kind: "outside", key: "" };
const CHAT: UsageUseRef = { kind: "chat", key: "" };

/** The top chat of a subagent's chat; itself for any other. */
function rootThread(index: UsageAttributionIndex, threadId: string): string {
  let current = threadId;
  // A cycle cannot be written, but a loop over stored data still gets a bound.
  for (let depth = 0; depth < 32; depth += 1) {
    const parent = index.parents.get(current);
    if (parent === undefined) return current;
    current = parent;
  }
  return current;
}

/** The turn of `threadId` a record stamped `timestampMs` belongs to: the last one started by then. */
function runAt(
  index: UsageAttributionIndex,
  threadId: string,
  timestampMs: number,
): UsageRun | undefined {
  const runs = index.runs.get(threadId);
  if (runs === undefined) return undefined;
  let found = runs[0];
  for (const run of runs) {
    if (run.startedAtMs > timestampMs + RUN_START_SLACK_MS) break;
    found = run;
  }
  return found;
}

/** What a turn of a top chat is for. */
function useOfRun(
  index: UsageAttributionIndex,
  threadId: string,
  run: UsageRun | undefined,
): UsageUseRef {
  if (run !== undefined && run.scheduledTaskId !== null) {
    return { kind: "routine", key: run.scheduledTaskId };
  }
  const topic = index.threadTopics.get(threadId);
  return topic === undefined ? CHAT : { kind: "topic", key: topic };
}

/**
 * What one usage record was for. A turn a scheduled task started is that routine's, in whichever
 * chat it ran; any other turn belongs to its chat's topic, or to the other chats. A subagent's
 * usage goes where the turn that started it goes.
 */
function usageUseOf(
  index: UsageAttributionIndex,
  record: { readonly sessionId: string; readonly timestampMs: number },
): UsageUseRef {
  const sessionThread = index.sessionThreads.get(record.sessionId);
  if (sessionThread === undefined) return OUTSIDE;
  const threadId = rootThread(index, sessionThread);
  return useOfRun(index, threadId, runAt(index, threadId, record.timestampMs));
}

const sourceKey = (use: UsageUseRef) => `${use.kind}\u0001${use.key}`;

export class MajordomeUsage extends Context.Service<
  MajordomeUsage,
  {
    readonly byUse: (
      input: UsageSummaryInput,
    ) => Effect.Effect<MajordomeUsageByUse, UsageReadError>;
  }
>()("t3/majordome/MajordomeUsage") {}

const make = Effect.gen(function* () {
  const usage = yield* UsageService.UsageService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const config = yield* ServerConfig.ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  /** Each topic's chats on this server, and each topic's name from its notes folder. */
  const readTopics = Effect.fn("MajordomeUsage.readTopics")(function* () {
    const state = yield* provideFs(
      readTopicThreadsState(topicThreadsStatePath(path, config.stateDir)),
    );
    const threadTopics = new Map<string, string>();
    const labels = new Map<string, { readonly id: string; readonly label: string }>();
    for (const [projectId, project] of Object.entries(state.projects)) {
      const key = (topicId: string) => `${projectId}\u0001${topicId}`;
      for (const [topicId, threadId] of Object.entries(project.threads)) {
        threadTopics.set(threadId, key(topicId));
      }
      for (const [topicId, threadIds] of Object.entries(project.sideThreads ?? {})) {
        for (const threadId of threadIds) threadTopics.set(threadId, key(topicId));
      }
      const stored = Option.getOrUndefined(yield* projects.get(ProjectId.make(projectId)));
      const topics =
        stored === undefined ? [] : yield* provideFs(readVaultTopics(stored.workspaceRoot));
      const titles = new Map(topics.map((topic) => [topic.id, topic.title]));
      for (const topicId of new Set([
        ...Object.keys(project.threads),
        ...Object.keys(project.sideThreads ?? {}),
      ])) {
        labels.set(key(topicId), { id: topicId, label: titles.get(topicId) ?? "" });
      }
    }
    return { threadTopics, labels };
  });

  const readIndex = Effect.fn("MajordomeUsage.readIndex")(function* (sinceMs: number) {
    const sessions = yield* sql<{ sessionId: string; threadId: string }>`
      SELECT json_extract(payload_json, '$.nativeThreadRef.nativeId') AS "sessionId",
        thread_id AS "threadId"
      FROM orchestration_v2_projection_provider_threads
      WHERE thread_id IS NOT NULL
        AND json_extract(payload_json, '$.nativeThreadRef.nativeId') IS NOT NULL
    `.pipe(NodeSqliteClient.readOnly);
    const subagents = yield* sql<{ threadId: string; parentThreadId: string }>`
      SELECT thread_id AS "threadId",
        json_extract(payload_json, '$.lineage.parentThreadId') AS "parentThreadId"
      FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.lineage.relationshipToParent') = 'subagent'
        AND json_extract(payload_json, '$.lineage.parentThreadId') IS NOT NULL
    `.pipe(NodeSqliteClient.readOnly);
    const cutoff = DateTime.formatIso(DateTime.makeUnsafe(sinceMs - RUN_LOOKBACK_MS));
    const runRows = yield* sql<{
      threadId: string;
      startedAt: string;
      scheduledTaskId: string | null;
    }>`
      SELECT run.thread_id AS "threadId",
        COALESCE(json_extract(run.payload_json, '$.startedAt'), run.requested_at) AS "startedAt",
        json_extract(message.payload_json, '$.scheduledTaskId') AS "scheduledTaskId"
      FROM orchestration_v2_projection_runs AS run
      LEFT JOIN orchestration_v2_projection_messages AS message
        ON message.message_id = json_extract(run.payload_json, '$.userMessageId')
      WHERE run.completed_at IS NULL OR run.completed_at >= ${cutoff}
    `.pipe(NodeSqliteClient.readOnly);
    const runs = new Map<string, UsageRun[]>();
    for (const row of runRows) {
      const startedAtMs = Date.parse(row.startedAt);
      if (Number.isNaN(startedAtMs)) continue;
      const list = runs.get(row.threadId) ?? [];
      list.push({ threadId: row.threadId, startedAtMs, scheduledTaskId: row.scheduledTaskId });
      runs.set(row.threadId, list);
    }
    for (const list of runs.values()) list.sort((a, b) => a.startedAtMs - b.startedAtMs);
    const tasks = yield* sql<{ taskId: string; title: string }>`
      SELECT task_id AS "taskId", title FROM scheduled_tasks
    `.pipe(NodeSqliteClient.readOnly);
    const topics = yield* readTopics();
    return {
      index: {
        sessionThreads: new Map(sessions.map((row) => [row.sessionId, row.threadId])),
        parents: new Map(subagents.map((row) => [row.threadId, row.parentThreadId])),
        runs,
        threadTopics: topics.threadTopics,
      } satisfies UsageAttributionIndex,
      topicLabels: topics.labels,
      taskTitles: new Map(tasks.map((row) => [row.taskId, row.title])),
    };
  });

  const byUse: MajordomeUsage["Service"]["byUse"] = Effect.fn("MajordomeUsage.byUse")(
    function* (input) {
      const hourly =
        input.resolution === "hour" &&
        input.sinceTime !== undefined &&
        input.untilTime !== undefined
          ? { sinceTimeMs: Date.parse(input.sinceTime), untilTimeMs: Date.parse(input.untilTime) }
          : {};
      // A day in any zone starts within a day of the same date in UTC.
      const sinceMs =
        hourly.sinceTimeMs ?? Date.parse(`${input.sinceDay}T00:00:00Z`) - 24 * 60 * 60 * 1000;
      const { index, topicLabels, taskTitles } = yield* readIndex(
        Number.isNaN(sinceMs) ? 0 : sinceMs,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new UsageReadError({
              reason: "scanFailed",
              detail: "Could not read this server's chats.",
              cause,
            }),
        ),
      );

      const refs = new Map<string, UsageUseRef>();
      const buckets = yield* usage.readBySource(input, (record) => {
        const use = usageUseOf(index, record);
        const key = sourceKey(use);
        if (!refs.has(key)) refs.set(key, use);
        return key;
      });

      interface Totals {
        readonly ref: UsageUseRef;
        runs: number;
        readonly byProvider: Map<UsageProviderKind, { costUsd: number; tokens: number }>;
      }
      const totals = new Map<string, Totals>();
      const totalsOf = (ref: UsageUseRef) => {
        const key = sourceKey(ref);
        let entry = totals.get(key);
        if (entry === undefined) {
          entry = { ref, runs: 0, byProvider: new Map() };
          totals.set(key, entry);
        }
        return entry;
      };
      for (const bucket of buckets) {
        const ref = refs.get(bucket.sourcePath ?? "");
        if (ref === undefined) continue;
        const entry = totalsOf(ref);
        const sum = entry.byProvider.get(bucket.provider) ?? { costUsd: 0, tokens: 0 };
        sum.costUsd += bucket.costUsd;
        sum.tokens += totalTokens(bucket.totals);
        entry.byProvider.set(bucket.provider, sum);
      }

      const inWindow = usageTimestampFilter({ ...input, ...hourly });
      for (const [threadId, runs] of index.runs) {
        // A subagent's turns are part of the turn that started it.
        if (index.parents.has(threadId)) continue;
        for (const run of runs) {
          if (inWindow(run.startedAtMs)) totalsOf(useOfRun(index, threadId, run)).runs += 1;
        }
      }

      const uses = [...totals.values()].map(({ ref, runs, byProvider }): MajordomeUsageUse => {
        const topic = ref.kind === "topic" ? topicLabels.get(ref.key) : undefined;
        return {
          kind: ref.kind,
          id: topic?.id ?? ref.key,
          label: ref.kind === "routine" ? (taskTitles.get(ref.key) ?? "") : (topic?.label ?? ""),
          runs,
          byProvider: [...byProvider].map(([provider, sum]) => ({ provider, ...sum })),
        };
      });
      return { uses };
    },
  );

  return MajordomeUsage.of({ byUse });
});

export const layer = Layer.effect(MajordomeUsage, make);
