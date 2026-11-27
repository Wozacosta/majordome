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
  scheduledTaskThreadMode,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { memoryPassPrompt, VAULT_CONVENTIONS as conventions } from "./memoryPassPrompt.ts";
import type { VaultLayout } from "./vaultConfig.ts";

type RoutineKey = "start-my-day" | "review-my-week" | "digest-my-inbox" | "tidy-my-memory";

/**
 * Defaults that came after a vault's first routines. The ledger records each per vault, so a vault
 * from before one gets it once and a routine the owner then deletes stays deleted.
 */
const LATER_ROUTINES: ReadonlyArray<RoutineKey> = ["tidy-my-memory"];

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

function defaultRoutines(input: {
  readonly projectId: ProjectId;
  readonly layout: VaultLayout;
  readonly modelSelection: ModelSelection;
  readonly autoMode: RuntimeMode;
}): ReadonlyArray<ScheduledTaskUpsertInput> {
  const { dailyFolder, inboxFolder, memory, me } = input.layout;
  const common = {
    projectId: input.projectId,
    // One conversation per routine: each run adds to it, starting from a clean session.
    threadMode: "fresh_session",
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
    {
      ...common,
      // It only reads and edits notes; Auto keeps a stray command from waiting for the owner at night.
      runtimeMode: input.autoMode,
      id: routineTaskId(input.projectId, "tidy-my-memory"),
      title: "Tidy my memory",
      enabled: true,
      // After the day's last notes and clear of the hour clocks skip or repeat.
      schedule: { type: "fixed_time", timeOfDay: "03:30" },
      prompt: memoryPassPrompt({ memory, me, dailyFolder }),
    },
  ];
}

const RoutineLedger = Schema.Struct({
  projects: Schema.Array(Schema.String),
  /** Projects whose routines had their one move to Auto; ledgers from before it lack the key. */
  autoMode: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Projects whose routines had their one move to a conversation each; older ledgers lack the key. */
  oneChat: Schema.optionalKey(Schema.Array(Schema.String)),
  /** By routine key, the projects that were offered a default added later (`LATER_ROUTINES`). */
  added: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
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
      oneChat: [...new Set(ledger.oneChat)].toSorted(),
      added: Object.fromEntries(
        Object.entries(ledger.added ?? {}).map(([key, projects]) => [
          key,
          [...new Set(projects)].toSorted(),
        ]),
      ),
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
 * Moves the project's routines that opened a new conversation on every run, as they all once did,
 * to one conversation each. Reminders and routines already tied to a conversation are left alone.
 */
const moveRoutinesToOneChat = Effect.fn("majordome.moveRoutinesToOneChat")(function* (input: {
  readonly projectId: ProjectId;
  readonly tasks: ReadonlyArray<ScheduledTask>;
}) {
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  for (const task of input.tasks) {
    if (
      task.projectId !== input.projectId ||
      task.schedule.type === "once" ||
      task.schedule.type === "webhook" ||
      scheduledTaskThreadMode(task) !== "new_thread"
    ) {
      continue;
    }
    yield* scheduledTasks.upsert({
      id: task.id,
      requireExisting: true,
      title: task.title,
      prompt: task.prompt,
      enabled: task.enabled,
      schedule: task.schedule,
      projectId: task.projectId,
      threadMode: "fresh_session",
      workspaceStrategy: task.workspaceStrategy,
      modelSelection: task.modelSelection,
      runtimeMode: task.runtimeMode,
      interactionMode: task.interactionMode,
      creationSource: task.creationSource,
    });
  }
});

const withAdded = (
  added: RoutineLedger["added"],
  keys: ReadonlyArray<RoutineKey>,
  projectId: ProjectId,
) => ({
  ...added,
  ...Object.fromEntries(keys.map((key) => [key, [...(added?.[key] ?? []), projectId]])),
});

/**
 * Creates the default routines unless this server already did for the project; a vault from before
 * a later default gets that one once. A routine that exists is left as the user edited it, apart
 * from its one move to Auto. Without a model to run them, nothing is created or recorded, so a
 * later call can try again. Callers serialize calls for one ledger.
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
      const needsAuto = !ledger.autoMode?.includes(input.projectId);
      const missing = LATER_ROUTINES.filter(
        (key) => !ledger.added?.[key]?.includes(input.projectId),
      );
      const needsOneChat = !ledger.oneChat?.includes(input.projectId);
      if (!needsAuto && !needsOneChat && missing.length === 0) return "exists" as const;
      const tasks = (yield* scheduledTasks.list()).tasks;
      const settled =
        needsAuto &&
        (yield* moveRoutinesToAuto({
          projectId: input.projectId,
          tasks,
          autoMode: input.autoMode,
        }));
      const modelSelection = missing.length === 0 ? null : yield* input.modelSelection;
      let added = false;
      if (modelSelection !== null) {
        const autoMode = (yield* input.autoMode(modelSelection)) ?? "auto-accept-edits";
        const missingIds = new Set<string>(
          missing.map((key) => routineTaskId(input.projectId, key)),
        );
        for (const routine of defaultRoutines({ ...input, modelSelection, autoMode })) {
          if (routine.id === undefined || !missingIds.has(routine.id)) continue;
          if (tasks.some((task) => task.id === routine.id)) continue;
          yield* scheduledTasks.upsert(routine);
          added = true;
        }
      }
      if (needsOneChat) {
        // Listed again: the move to Auto above may have saved some of them.
        yield* moveRoutinesToOneChat({
          projectId: input.projectId,
          tasks: (yield* scheduledTasks.list()).tasks,
        });
      }
      if (settled || needsOneChat || modelSelection !== null) {
        yield* writeLedger(input.ledgerPath, {
          ...ledger,
          autoMode: movedToAuto(settled),
          oneChat: [...(ledger.oneChat ?? []), input.projectId],
          added:
            modelSelection === null
              ? (ledger.added ?? {})
              : withAdded(ledger.added, missing, input.projectId),
        });
      }
      return added ? ("added" as const) : ("exists" as const);
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
    yield* moveRoutinesToOneChat({
      projectId: input.projectId,
      tasks: (yield* scheduledTasks.list()).tasks,
    });
    yield* writeLedger(input.ledgerPath, {
      projects: [...ledger.projects, input.projectId],
      autoMode: movedToAuto(settled),
      oneChat: [...(ledger.oneChat ?? []), input.projectId],
      added: withAdded(ledger.added, LATER_ROUTINES, input.projectId),
    });
    return "created" as const;
  },
);
