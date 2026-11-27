// @effect-diagnostics globalDate:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type MajordomeUsageUse,
  ProjectId,
  UsageDay,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import type { UsageRecord } from "@t3tools/provider-core/server/usage";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as UsageService from "../usage/UsageService.ts";
import { UsageAggregator } from "../usage/usageAggregation.ts";
import { parseRateTable } from "../usage/usagePricing.ts";
import * as MajordomeUsage from "./MajordomeUsage.ts";
import { topicThreadsStatePath, writeTopicThreadsState } from "./topicThreads.ts";

const vaultProject = ProjectId.make("vault-project");
const BRIEF = `majordome:${vaultProject}:start-my-day`;
const REMINDER = "scheduled-task:water-the-plants";
const GONE_TASK = "scheduled-task:removed-since";

// A dollar a million output tokens, so a record's cost is its output tokens in millionths.
const RATES = parseRateTable({
  "claude-test": { input_cost_per_token: 0, output_cost_per_token: 1e-6 },
  "gpt-test": { input_cost_per_token: 0, output_cost_per_token: 2e-6 },
});

const record = (
  sessionId: string,
  at: string,
  outputTokens: number,
  provider: UsageProviderKind = "claude",
): UsageRecord => ({
  provider,
  timestampMs: Date.parse(at),
  model: provider === "claude" ? "claude-test" : "gpt-test",
  sessionId,
  totals: {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens,
    reasoningTokens: 0,
  },
  reportedCostUsd: null,
  speed: "standard",
  dedupeKey: null,
});

/** The usage service's own aggregation over fixed records, in place of reading session files. */
const layerUsage = (records: ReadonlyArray<UsageRecord>) =>
  Layer.mock(UsageService.UsageService)({
    readBySource: (input, sourceOf) =>
      Effect.sync(() => {
        const hourly =
          input.sinceTime === undefined || input.untilTime === undefined
            ? {}
            : {
                sinceTimeMs: Date.parse(input.sinceTime),
                untilTimeMs: Date.parse(input.untilTime),
              };
        const aggregator = new UsageAggregator({
          timeZone: input.timeZone,
          sinceDay: input.sinceDay,
          untilDay: input.untilDay,
          resolution: input.resolution ?? "day",
          ...hourly,
          rates: RATES,
        });
        for (const entry of records) aggregator.add(entry, sourceOf(entry));
        return aggregator.finish().buckets;
      }),
  });

const NOVEMBER: UsageSummaryInput = {
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-11-01"),
  untilDay: UsageDay.make("2026-11-30"),
};

const setUp = Effect.fn("test.setUp")(function* (records: ReadonlyArray<UsageRecord>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  // The cases share one database.
  yield* sql`DELETE FROM orchestration_v2_projection_threads`;
  yield* sql`DELETE FROM orchestration_v2_projection_provider_threads`;
  yield* sql`DELETE FROM orchestration_v2_projection_runs`;
  yield* sql`DELETE FROM orchestration_v2_projection_messages`;
  yield* sql`DELETE FROM scheduled_tasks`;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-usage-vault-" });
  yield* fs.makeDirectory(path.join(vault, ".majordome"), { recursive: true });
  yield* fs.writeFileString(
    path.join(vault, ".majordome", "topics.json"),
    JSON.stringify({
      topics: [
        { id: "fitness", title: "Fitness", folder: "personal/fitness" },
        { id: "money", title: "Money", folder: "admin/money" },
      ],
    }),
  );
  yield* writeTopicThreadsState(topicThreadsStatePath(path, stateDir), {
    projects: {
      [vaultProject]: {
        threads: { fitness: "thread-fitness", money: "thread-money", gone: "thread-gone-topic" },
        sideThreads: { fitness: ["thread-fitness-side"] },
      },
    },
  } as never);

  const thread = (threadId: string, parentThreadId: string | null = null) =>
    sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        created_at, updated_at, payload_json
      ) VALUES (
        ${threadId}, ${vaultProject}, ${threadId}, 'claudeAgent', 'full-access', 'default',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        ${JSON.stringify({
          lineage: {
            parentThreadId,
            relationshipToParent: parentThreadId === null ? null : "subagent",
          },
        })}
      )
    `;
  /** The provider session a chat runs in; a chat started afresh has several. */
  const session = (sessionId: string, threadId: string) =>
    sql`
      INSERT INTO orchestration_v2_projection_provider_threads (
        provider_thread_id, thread_id, provider, status, updated_at, payload_json
      ) VALUES (
        ${`provider-thread:${sessionId}`}, ${threadId}, 'claudeAgent', 'idle',
        '2026-10-01T00:00:00.000Z',
        ${JSON.stringify({ nativeThreadRef: { nativeId: sessionId } })}
      )
    `;
  let ordinal = 0;
  const run = (
    threadId: string,
    startedAt: string,
    completedAt: string | null,
    scheduledTaskId?: string,
  ) => {
    ordinal += 1;
    const messageId = `message-${ordinal}`;
    return sql`
      INSERT INTO orchestration_v2_projection_messages (
        message_id, thread_id, role, streaming, created_at, updated_at, payload_json
      ) VALUES (
        ${messageId}, ${threadId}, 'user', 0, ${startedAt}, ${startedAt},
        ${JSON.stringify(scheduledTaskId === undefined ? {} : { scheduledTaskId })}
      )
    `.pipe(
      Effect.andThen(sql`
        INSERT INTO orchestration_v2_projection_runs (
          run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json
        ) VALUES (
          ${`run-${ordinal}`}, ${threadId}, ${ordinal}, 'claudeAgent', 'completed', ${startedAt},
          ${completedAt}, ${JSON.stringify({ startedAt, userMessageId: messageId })}
        )
      `),
    );
  };
  const task = (taskId: string, title: string) =>
    sql`
      INSERT INTO scheduled_tasks (
        task_id, title, prompt, enabled, schedule_json, project_id, workspace_strategy_json,
        model_selection_json, runtime_mode, interaction_mode, created_by, creation_source,
        created_at, updated_at, last_run_status, run_count
      ) VALUES (
        ${taskId}, ${title}, 'prompt', 1, '{}', ${vaultProject}, '{}', '{}', 'full-access',
        'default', 'user', 'user', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        'idle', 0
      )
    `;

  const service = yield* Effect.service(MajordomeUsage.MajordomeUsage).pipe(
    Effect.provide(
      MajordomeUsage.layer.pipe(
        Layer.provide(layerUsage(records)),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                projectId === vaultProject
                  ? Option.some({ workspaceRoot: vault } as ProjectStore.ProjectRow)
                  : Option.none(),
              ),
          }),
        ),
      ),
    ),
  );
  return { service, thread, session, run, task };
});

const testLayer = ServerConfig.layerTest(process.cwd(), { prefix: "majordome-usage-" }).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(NodeServices.layer),
);

/** The uses in a fixed order, with money in whole millionths so sums compare exactly. */
const readable = (uses: ReadonlyArray<MajordomeUsageUse>) =>
  uses
    .map((use) => ({
      use: `${use.kind}:${use.id}:${use.label}`,
      runs: use.runs,
      byProvider: Object.fromEntries(
        use.byProvider.map((entry) => [
          entry.provider,
          { micros: Math.round(entry.costUsd * 1e6), tokens: entry.tokens },
        ]),
      ),
    }))
    .toSorted((left, right) => left.use.localeCompare(right.use));

it.layer(testLayer)("MajordomeUsage", (it) => {
  it.effect("cuts a month by routine, by topic, by the other chats and by what is not a chat", () =>
    Effect.gen(function* () {
      const { service, thread, session, run, task } = yield* setUp([
        // The morning brief, twice, each in a chat of its own.
        record("s-brief-1", "2026-11-03T07:00:05Z", 100),
        record("s-brief-2", "2026-11-04T07:00:05Z", 150),
        // A reminder posted into the Fitness topic's conversation, between two of the owner's turns.
        record("s-fitness", "2026-11-05T09:00:10Z", 40),
        record("s-fitness", "2026-11-05T12:00:10Z", 7),
        record("s-fitness", "2026-11-05T18:00:10Z", 60),
        // The topic started afresh: a second session of the same conversation.
        record("s-fitness-fresh", "2026-11-06T09:00:10Z", 20),
        // Its other chat, and a subagent that chat started.
        record("s-fitness-side", "2026-11-07T09:00:10Z", 30),
        record("s-fitness-side-agent", "2026-11-07T09:01:00Z", 5),
        record("s-money", "2026-11-08T09:00:10Z", 500),
        // A topic removed from the notes folder keeps its usage, without a name.
        record("s-gone-topic", "2026-11-09T09:00:10Z", 9),
        // A chat that belongs to no topic, on two providers.
        record("s-chat", "2026-11-10T09:00:10Z", 11),
        record("s-chat-codex", "2026-11-10T10:00:10Z", 13, "codex"),
        // A routine removed since.
        record("s-gone-task", "2026-11-11T07:00:05Z", 3),
        // The same AI used in a terminal: no chat of this server knows the session.
        record("s-terminal", "2026-11-12T09:00:10Z", 1000),
        // Outside the month on both sides.
        record("s-brief-1", "2026-10-31T23:59:59Z", 999),
        record("s-chat", "2026-12-01T00:00:00Z", 999),
      ]);
      for (const id of [
        "thread-brief-1",
        "thread-brief-2",
        "thread-fitness",
        "thread-fitness-side",
        "thread-money",
        "thread-gone-topic",
        "thread-chat",
        "thread-gone-task",
      ]) {
        yield* thread(id);
      }
      yield* thread("thread-fitness-side-agent", "thread-fitness-side");
      yield* session("s-brief-1", "thread-brief-1");
      yield* session("s-brief-2", "thread-brief-2");
      yield* session("s-fitness", "thread-fitness");
      yield* session("s-fitness-fresh", "thread-fitness");
      yield* session("s-fitness-side", "thread-fitness-side");
      yield* session("s-fitness-side-agent", "thread-fitness-side-agent");
      yield* session("s-money", "thread-money");
      yield* session("s-gone-topic", "thread-gone-topic");
      yield* session("s-chat", "thread-chat");
      yield* session("s-chat-codex", "thread-chat");
      yield* session("s-gone-task", "thread-gone-task");
      yield* task(BRIEF, "Start my day");
      yield* task(REMINDER, "Reminder: water the plants");

      yield* run("thread-brief-1", "2026-11-03T07:00:00Z", "2026-11-03T07:01:00Z", BRIEF);
      yield* run("thread-brief-2", "2026-11-04T07:00:00Z", "2026-11-04T07:01:00Z", BRIEF);
      yield* run("thread-fitness", "2026-11-05T09:00:00Z", "2026-11-05T09:01:00Z");
      yield* run("thread-fitness", "2026-11-05T12:00:00Z", "2026-11-05T12:01:00Z", REMINDER);
      yield* run("thread-fitness", "2026-11-05T18:00:00Z", "2026-11-05T18:01:00Z");
      yield* run("thread-fitness", "2026-11-06T09:00:00Z", "2026-11-06T09:01:00Z");
      yield* run("thread-fitness-side", "2026-11-07T09:00:00Z", "2026-11-07T09:02:00Z");
      yield* run("thread-fitness-side-agent", "2026-11-07T09:00:30Z", "2026-11-07T09:01:30Z");
      yield* run("thread-money", "2026-11-08T09:00:00Z", "2026-11-08T09:01:00Z");
      yield* run("thread-gone-topic", "2026-11-09T09:00:00Z", "2026-11-09T09:01:00Z");
      yield* run("thread-chat", "2026-11-10T09:00:00Z", "2026-11-10T09:01:00Z");
      yield* run("thread-chat", "2026-11-10T10:00:00Z", null);
      yield* run("thread-gone-task", "2026-11-11T07:00:00Z", "2026-11-11T07:01:00Z", GONE_TASK);

      const { uses } = yield* service.byUse(NOVEMBER);
      assert.deepEqual(readable(uses), [
        {
          use: "chat::",
          runs: 2,
          byProvider: {
            claude: { micros: 11, tokens: 11 },
            codex: { micros: 26, tokens: 13 },
          },
        },
        { use: "outside::", runs: 0, byProvider: { claude: { micros: 1000, tokens: 1000 } } },
        {
          use: `routine:${BRIEF}:Start my day`,
          runs: 2,
          byProvider: { claude: { micros: 250, tokens: 250 } },
        },
        {
          use: `routine:${GONE_TASK}:`,
          runs: 1,
          byProvider: { claude: { micros: 3, tokens: 3 } },
        },
        {
          use: `routine:${REMINDER}:Reminder: water the plants`,
          runs: 1,
          byProvider: { claude: { micros: 7, tokens: 7 } },
        },
        // 40 + 60 in the conversation, 20 after the fresh start, 30 + 5 in the other chat.
        {
          use: "topic:fitness:Fitness",
          runs: 4,
          byProvider: { claude: { micros: 155, tokens: 155 } },
        },
        { use: "topic:gone:", runs: 1, byProvider: { claude: { micros: 9, tokens: 9 } } },
        { use: "topic:money:Money", runs: 1, byProvider: { claude: { micros: 500, tokens: 500 } } },
      ]);
      // Every record of the month is in exactly one use.
      assert.strictEqual(
        uses.flatMap((use) => use.byProvider).reduce((sum, entry) => sum + entry.tokens, 0),
        100 + 150 + 40 + 7 + 60 + 20 + 30 + 5 + 500 + 9 + 11 + 13 + 3 + 1000,
      );
    }),
  );

  it.effect("keeps to the asked days in the asked time zone, and to the asked hours", () =>
    Effect.gen(function* () {
      const { service, thread, session, run, task } = yield* setUp([
        // 23:30 in Paris on the 14th, 22:30 UTC.
        record("s-brief", "2026-11-14T22:30:05Z", 10),
        // 00:30 in Paris on the 16th, still the 15th in UTC.
        record("s-brief", "2026-11-15T23:30:05Z", 20),
        record("s-brief", "2026-11-15T07:00:05Z", 40),
      ]);
      yield* thread("thread-brief");
      yield* session("s-brief", "thread-brief");
      yield* task(BRIEF, "Start my day");
      yield* run("thread-brief", "2026-11-14T22:30:00Z", "2026-11-14T22:31:00Z", BRIEF);
      yield* run("thread-brief", "2026-11-15T07:00:00Z", "2026-11-15T07:01:00Z", BRIEF);
      yield* run("thread-brief", "2026-11-15T23:30:00Z", "2026-11-15T23:31:00Z", BRIEF);

      const day = UsageDay.make("2026-11-15");
      const paris = yield* service.byUse({
        timeZone: "Europe/Paris",
        sinceDay: day,
        untilDay: day,
      });
      assert.deepEqual(readable(paris.uses), [
        {
          use: `routine:${BRIEF}:Start my day`,
          runs: 1,
          byProvider: { claude: { micros: 40, tokens: 40 } },
        },
      ]);
      const utc = yield* service.byUse({ timeZone: "UTC", sinceDay: day, untilDay: day });
      assert.deepEqual(readable(utc.uses), [
        {
          use: `routine:${BRIEF}:Start my day`,
          runs: 2,
          byProvider: { claude: { micros: 60, tokens: 60 } },
        },
      ]);
      const hours = yield* service.byUse({
        timeZone: "UTC",
        sinceDay: UsageDay.make("2026-11-14"),
        untilDay: day,
        resolution: "hour",
        sinceTime: "2026-11-14T22:00:00.000Z",
        untilTime: "2026-11-15T08:00:00.000Z",
      });
      assert.deepEqual(readable(hours.uses), [
        {
          use: `routine:${BRIEF}:Start my day`,
          runs: 2,
          byProvider: { claude: { micros: 50, tokens: 50 } },
        },
      ]);
    }),
  );

  it.effect("has no uses on a server with no usage and no chats", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp([]);
      assert.deepEqual(yield* service.byUse(NOVEMBER), { uses: [] });
    }),
  );
});
