/**
 * Default routines for a vault, as T3 scheduled tasks. Created once per vault project per server;
 * a ledger in the server's state directory (each server has its own tasks) records that, so a
 * routine the user deletes stays deleted.
 */

import {
  type ModelSelection,
  type ProjectId,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import type { VaultLayout } from "./vaultConfig.ts";

type RoutineKey = "start-my-day" | "review-my-week" | "digest-my-inbox";

/** Stable per project, so a restart finds the routines it made instead of making more. */
export const routineTaskId = (projectId: ProjectId, key: RoutineKey) =>
  ScheduledTaskId.make(`majordome:${projectId}:${key}`);

const conventions =
  "Follow the conventions in AGENTS.md at the vault root, and use the vault's own skills or commands for this when it has them.";

function defaultRoutines(input: {
  readonly projectId: ProjectId;
  readonly layout: VaultLayout;
  readonly modelSelection: ModelSelection;
}): ReadonlyArray<ScheduledTaskUpsertInput> {
  const { dailyFolder, inboxFolder, memory } = input.layout;
  const common = {
    projectId: input.projectId,
    threadMode: "new_thread",
    workspaceStrategy: { type: "root" },
    modelSelection: input.modelSelection,
    // Unattended runs may edit notes; anything else waits for the user's approval.
    runtimeMode: "auto-accept-edits",
    interactionMode: "default",
    createdBy: "system",
    creationSource: "server",
  } as const;
  return [
    {
      ...common,
      id: routineTaskId(input.projectId, "start-my-day"),
      title: "Start my day",
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: "08:00" },
      prompt: [
        `Run my morning routine in this vault. ${conventions}`,
        "",
        `1. Open today's daily note in \`${dailyFolder}/\` (named YYYY-MM-DD.md), or create it from the vault's daily template if it does not exist yet.`,
        `2. Look in \`${inboxFolder}/\` for anything new and list it in the daily note.`,
        "3. Find open todos across the vault that are overdue or due today.",
        "4. Propose up to three things to focus on today and add them to the daily note.",
        "",
        "Keep it short. Do not delete notes. If something needs my decision, ask me.",
      ].join("\n"),
    },
    {
      ...common,
      id: routineTaskId(input.projectId, "review-my-week"),
      title: "Review my week",
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: "18:00", weekdays: [0] },
      prompt: [
        `Run my weekly review in this vault. ${conventions}`,
        "",
        `1. Read this week's daily notes in \`${dailyFolder}/\` and the notes that changed this week.`,
        "2. Write a review of the week where the vault keeps reviews: what got done, what slipped, open loops, and up to three priorities for next week.",
        `3. Move anything worth remembering for a long time into \`${memory}\`, keeping it short.`,
        "",
        "Do not delete notes. If something needs my decision, ask me.",
      ].join("\n"),
    },
    {
      ...common,
      id: routineTaskId(input.projectId, "digest-my-inbox"),
      title: "Digest my inbox",
      // Runs when files land in the inbox. T3 tasks need a schedule; this one is off, and turning
      // it on also digests the inbox every evening.
      enabled: false,
      schedule: { type: "fixed_time", timeOfDay: "20:00" },
      prompt: [
        `New files landed in \`${inboxFolder}/\`. Digest them. ${conventions}`,
        "",
        "For each file there (skip hidden files):",
        "1. Read it and write a short note that summarizes it and links to it.",
        "2. File the note and the original where the vault's conventions say they belong.",
        "",
        `Leave a file in \`${inboxFolder}/\` when you cannot tell where it goes, and list those at the end. Do not delete anything.`,
      ].join("\n"),
    },
  ];
}

const RoutineLedger = Schema.Struct({ projects: Schema.Array(Schema.String) });
const RoutineLedgerJson = Schema.fromJsonString(RoutineLedger);
const decodeLedger = Schema.decodeUnknownOption(RoutineLedgerJson);
const encodeLedger = Schema.encodeSync(RoutineLedgerJson);

const readLedger = Effect.fn("majordome.readRoutineLedger")(function* (ledgerPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem.readFileString(ledgerPath).pipe(Effect.option);
  return new Set(
    Option.match(Option.flatMap(text, decodeLedger), {
      onNone: () => [],
      onSome: (ledger) => ledger.projects,
    }),
  );
});

const writeLedger = Effect.fn("majordome.writeRoutineLedger")(function* (
  ledgerPath: string,
  projects: ReadonlySet<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.tmp`;
  yield* fileSystem.writeFileString(
    temporary,
    encodeLedger({ projects: [...projects].toSorted() }),
  );
  yield* fileSystem.rename(temporary, ledgerPath);
});

/**
 * Creates the default routines unless this server already did for the project. A routine that
 * exists is left as the user edited it. Without a model to run them, nothing is created or
 * recorded, so a later call can try again. Callers serialize calls for one ledger.
 */
export const ensureDefaultRoutines = Effect.fn("majordome.ensureDefaultRoutines")(
  function* (input: {
    readonly ledgerPath: string;
    readonly projectId: ProjectId;
    readonly layout: VaultLayout;
    readonly modelSelection: Effect.Effect<ModelSelection | null>;
  }) {
    const ledger = yield* readLedger(input.ledgerPath);
    if (ledger.has(input.projectId)) return "exists" as const;
    const modelSelection = yield* input.modelSelection;
    if (modelSelection === null) return "no-model" as const;
    const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
    const existing = new Set((yield* scheduledTasks.list()).tasks.map((task) => task.id));
    for (const routine of defaultRoutines({ ...input, modelSelection })) {
      if (routine.id !== undefined && existing.has(routine.id)) continue;
      yield* scheduledTasks.upsert(routine);
    }
    yield* writeLedger(input.ledgerPath, new Set([...ledger, input.projectId]));
    return "created" as const;
  },
);
