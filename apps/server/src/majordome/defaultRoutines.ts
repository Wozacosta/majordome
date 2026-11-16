/**
 * Default routines for a vault, as T3 scheduled tasks. Created once per vault project per server;
 * a ledger in the server's state directory (each server has its own tasks) records that, so a
 * routine the user deletes stays deleted.
 */

import {
  isRuntimeModeAbove,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ScheduledTask,
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

/**
 * "Start my day" and "Review my week" run in Auto: the provider approves routine actions and asks
 * for risky ones. Where the provider or an administrator's ceiling doesn't allow Auto, they
 * auto-accept edits, as "Digest my inbox" always does since it reads files from outside the vault.
 */
const AUTO_ROUTINES: ReadonlyArray<RoutineKey> = ["start-my-day", "review-my-week"];

/** Auto when the provider supports it (all modes when it lists none) and no ceiling forbids it. */
export function autoRoutineMode(input: {
  readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
  readonly maxRuntimeMode: RuntimeMode | undefined;
}): RuntimeMode {
  const supported =
    input.supportedRuntimeModes === undefined ||
    input.supportedRuntimeModes.length === 0 ||
    input.supportedRuntimeModes.includes("auto");
  return supported && !isRuntimeModeAbove("auto", input.maxRuntimeMode)
    ? "auto"
    : "auto-accept-edits";
}

const conventions =
  "Follow the conventions in AGENTS.md at the vault root, and use the vault's own skills or commands for this when it has them.";

function defaultRoutines(input: {
  readonly projectId: ProjectId;
  readonly layout: VaultLayout;
  readonly modelSelection: ModelSelection;
  readonly autoMode: RuntimeMode;
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
      runtimeMode: input.autoMode,
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
      runtimeMode: input.autoMode,
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

const RoutineLedger = Schema.Struct({
  projects: Schema.Array(Schema.String),
  /** Projects whose routines had their one move to Auto; ledgers from before it lack the key. */
  autoMode: Schema.optionalKey(Schema.Array(Schema.String)),
});
type RoutineLedger = typeof RoutineLedger.Type;
const RoutineLedgerJson = Schema.fromJsonString(RoutineLedger);
const decodeLedger = Schema.decodeUnknownOption(RoutineLedgerJson);
const encodeLedger = Schema.encodeSync(RoutineLedgerJson);

/** Where a server keeps its routine ledger. */
export const routineLedgerPath = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "majordome", "routines.json");

const readLedger = Effect.fn("majordome.readRoutineLedger")(function* (ledgerPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem.readFileString(ledgerPath).pipe(Effect.option);
  return Option.getOrElse(Option.flatMap(text, decodeLedger), (): RoutineLedger => ({
    projects: [],
  }));
});

/** True once this server made the project's default routines, even if the owner deleted them since. */
export const hasDefaultRoutines = Effect.fn("majordome.hasDefaultRoutines")(function* (
  ledgerPath: string,
  projectId: ProjectId,
) {
  return (yield* readLedger(ledgerPath)).projects.includes(projectId);
});

const writeLedger = Effect.fn("majordome.writeRoutineLedger")(function* (
  ledgerPath: string,
  ledger: RoutineLedger,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.tmp`;
  yield* fileSystem.writeFileString(
    temporary,
    encodeLedger({
      projects: [...new Set(ledger.projects)].toSorted(),
      autoMode: [...new Set(ledger.autoMode)].toSorted(),
    }),
  );
  yield* fileSystem.rename(temporary, ledgerPath);
});

/**
 * Moves "Start my day" and "Review my week", made when routines auto-accepted edits, to Auto once.
 * Only a routine still in that old default moves; any other mode is the user's choice. False while
 * a routine's provider isn't known yet, so a later call tries again.
 */
const moveRoutinesToAuto = Effect.fn("majordome.moveRoutinesToAuto")(function* (input: {
  readonly projectId: ProjectId;
  readonly tasks: ReadonlyArray<ScheduledTask>;
  readonly autoMode: (modelSelection: ModelSelection) => Effect.Effect<RuntimeMode | null>;
}) {
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  let settled = true;
  for (const key of AUTO_ROUTINES) {
    const task = input.tasks.find((entry) => entry.id === routineTaskId(input.projectId, key));
    if (
      task === undefined ||
      task.runtimeMode !== "auto-accept-edits" ||
      task.schedule.type === "webhook"
    ) {
      continue;
    }
    const mode = yield* input.autoMode(task.modelSelection);
    if (mode === null) settled = false;
    if (mode !== "auto") continue;
    yield* scheduledTasks.upsert({
      id: task.id,
      requireExisting: true,
      title: task.title,
      prompt: task.prompt,
      enabled: task.enabled,
      schedule: task.schedule,
      projectId: task.projectId,
      threadId: task.threadId,
      threadMode: task.threadMode,
      workspaceStrategy: task.workspaceStrategy,
      modelSelection: task.modelSelection,
      runtimeMode: "auto",
      interactionMode: task.interactionMode,
      creationSource: task.creationSource,
    });
  }
  return settled;
});

/**
 * Creates the default routines unless this server already did for the project. A routine that
 * exists is left as the user edited it, apart from its one move to Auto. Without a model to run
 * them, nothing is created or recorded, so a later call can try again. Callers serialize calls for
 * one ledger.
 */
export const ensureDefaultRoutines = Effect.fn("majordome.ensureDefaultRoutines")(
  function* (input: {
    readonly ledgerPath: string;
    readonly projectId: ProjectId;
    readonly layout: VaultLayout;
    readonly modelSelection: Effect.Effect<ModelSelection | null>;
    /** The mode for Auto routines on this model's provider (`autoRoutineMode`), null if unknown. */
    readonly autoMode: (modelSelection: ModelSelection) => Effect.Effect<RuntimeMode | null>;
  }) {
    const ledger = yield* readLedger(input.ledgerPath);
    const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
    const movedToAuto = (settled: boolean) =>
      settled ? [...(ledger.autoMode ?? []), input.projectId] : (ledger.autoMode ?? []);

    if (ledger.projects.includes(input.projectId)) {
      if (ledger.autoMode?.includes(input.projectId)) return "exists" as const;
      const settled = yield* moveRoutinesToAuto({
        projectId: input.projectId,
        tasks: (yield* scheduledTasks.list()).tasks,
        autoMode: input.autoMode,
      });
      if (settled) yield* writeLedger(input.ledgerPath, { ...ledger, autoMode: movedToAuto(true) });
      return "exists" as const;
    }

    const modelSelection = yield* input.modelSelection;
    if (modelSelection === null) return "no-model" as const;
    const autoMode = yield* input.autoMode(modelSelection);
    const existing = (yield* scheduledTasks.list()).tasks;
    const existingIds = new Set(existing.map((task) => task.id));
    for (const routine of defaultRoutines({
      ...input,
      modelSelection,
      autoMode: autoMode ?? "auto-accept-edits",
    })) {
      if (routine.id !== undefined && existingIds.has(routine.id)) continue;
      yield* scheduledTasks.upsert(routine);
    }
    // Routines kept from before a lost ledger get their move too; new ones already have their mode.
    const settled =
      autoMode !== null &&
      (yield* moveRoutinesToAuto({
        projectId: input.projectId,
        tasks: existing,
        autoMode: input.autoMode,
      }));
    yield* writeLedger(input.ledgerPath, {
      projects: [...ledger.projects, input.projectId],
      autoMode: movedToAuto(settled),
    });
    return "created" as const;
  },
);
