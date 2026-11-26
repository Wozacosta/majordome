import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const MajordomeVaultHistoryInput = Schema.Struct({
  projectId: ProjectId,
  limit: Schema.optional(PositiveInt),
});
export type MajordomeVaultHistoryInput = typeof MajordomeVaultHistoryInput.Type;

export const MajordomeVaultChangesInput = Schema.Struct({ projectId: ProjectId });
export type MajordomeVaultChangesInput = typeof MajordomeVaultChangesInput.Type;

export const MajordomeRoutineKind = Schema.Literals([
  "start-my-day",
  "review-my-week",
  "digest-my-inbox",
  "tidy-my-memory",
]);
export type MajordomeRoutineKind = typeof MajordomeRoutineKind.Type;

export const MajordomeVaultHistoryEntry = Schema.Struct({
  commit: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  committedAt: Schema.String,
  /** True for runs Majordome saved; false for the owner's own changes. */
  byMajordome: Schema.Boolean,
  /** The thread whose run made this change, when it is known. */
  threadId: Schema.NullOr(Schema.String),
  files: Schema.Array(Schema.String),
  /** For a run: the start of the agent's final reply, in plain words. Absent when unknown. */
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  /** For a run a default routine started: which one. */
  routine: Schema.optional(Schema.NullOr(MajordomeRoutineKind)),
  /** A routine or reminder started the run, one of the defaults or the owner's own. */
  scheduled: Schema.optional(Schema.Boolean),
  /** For "Start my day": the start of the daily note it wrote, as plain lines. */
  dailyNotePreview: Schema.optional(Schema.NullOr(Schema.String)),
});
export type MajordomeVaultHistoryEntry = typeof MajordomeVaultHistoryEntry.Type;

/** Limits on unattended runs (routines and inbox digests), kept in the vault's config. */
export const MajordomeRoutineLimits = Schema.Struct({
  /** A run that works longer than this is stopped. Time waiting for the owner doesn't count. */
  runMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 24 * 60 })),
  /** Unattended runs started per day before routines pause until the next day. */
  runsPerDay: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
});
export type MajordomeRoutineLimits = typeof MajordomeRoutineLimits.Type;

/** A run the time limit stopped. */
export const MajordomeStoppedRun = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.String,
  stoppedAt: Schema.String,
});
export type MajordomeStoppedRun = typeof MajordomeStoppedRun.Type;

/** Which server runs the vault's routines: this one, another one, or none yet. */
export const MajordomeRoutinesRunner = Schema.Literals(["this-server", "another-server", "none"]);
export type MajordomeRoutinesRunner = typeof MajordomeRoutinesRunner.Type;

/** Whether the vault's routines can run on the server that is their runner, and if not, why. */
export const MajordomeRoutinesStatus = Schema.Struct({
  ready: Schema.Boolean,
  reason: Schema.optional(
    Schema.Literals([
      /** No provider on this server is signed in and ready. */
      "no-provider",
      "provider-signed-out",
      /** The routines' provider is turned off, not installed, or failing. */
      "provider-unavailable",
      /** A provider is ready; this server has not made the routines yet. */
      "not-created",
    ]),
  ),
  /** The provider the reason is about, as its display name. */
  provider: Schema.optional(Schema.String),
});
export type MajordomeRoutinesStatus = typeof MajordomeRoutinesStatus.Type;

export const MajordomeVaultHistoryResult = Schema.Struct({
  isVault: Schema.Boolean,
  entries: Schema.Array(MajordomeVaultHistoryEntry),
  routinesRunner: MajordomeRoutinesRunner,
  /** Only from the server that runs the vault's routines; absent from older servers. */
  routinesStatus: Schema.optional(MajordomeRoutinesStatus),
  /** The vault's daily and inbox folders, from its config. */
  folders: Schema.optional(Schema.Struct({ daily: Schema.String, inbox: Schema.String })),
  /**
   * The Markdown notes these entries touched that still exist, each with its first `# heading`
   * (null when it has none).
   */
  notes: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
  routineLimits: Schema.optional(MajordomeRoutineLimits),
  /** This server skipped a run today because the vault reached its runs per day. */
  pausedToday: Schema.optional(Schema.Boolean),
  /** Recent runs on this server that the time limit stopped, newest first. */
  stoppedRuns: Schema.optional(Schema.Array(MajordomeStoppedRun)),
  /** Set while the memory note is longer than what conversations load. */
  memoryOverLimit: Schema.optional(
    Schema.Struct({
      /** "Tidy my memory" is on here, so tonight's run shortens the note. */
      tidyRoutineOn: Schema.Boolean,
    }),
  ),
});
export type MajordomeVaultHistoryResult = typeof MajordomeVaultHistoryResult.Type;

export const MajordomeVaultUndoInput = Schema.Struct({
  projectId: ProjectId,
  commit: TrimmedNonEmptyString,
});
export type MajordomeVaultUndoInput = typeof MajordomeVaultUndoInput.Type;

export const MajordomeVaultUndoResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("undone"), commit: Schema.String }),
  Schema.Struct({ status: Schema.Literal("conflict"), files: Schema.Array(Schema.String) }),
  Schema.Struct({ status: Schema.Literal("unsaved-changes"), files: Schema.Array(Schema.String) }),
  Schema.Struct({ status: Schema.Literal("not-found") }),
]);
export type MajordomeVaultUndoResult = typeof MajordomeVaultUndoResult.Type;

export const MajordomeRunRoutinesHereInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeRunRoutinesHereInput = typeof MajordomeRunRoutinesHereInput.Type;

/**
 * Tells a server that another one runs the vault's routines, when the two copies disagree and
 * the move never reached it. `label` names that other server in the commit.
 */
export const MajordomeRunRoutinesElsewhereInput = Schema.Struct({
  projectId: ProjectId,
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type MajordomeRunRoutinesElsewhereInput = typeof MajordomeRunRoutinesElsewhereInput.Type;

/**
 * One run of a routine or reminder. `at` is when it started; for a run that was skipped
 * (`errorCode` "missed" or "held"), when it was due.
 */
export const MajordomeRoutineRun = Schema.Struct({
  taskId: ScheduledTaskId,
  at: IsoDateTime,
  status: Schema.Literals(["running", "succeeded", "failed"]),
  /** A `ScheduledTaskRunErrorCode` when the cause is a known one. A string so new codes decode. */
  errorCode: Schema.optional(Schema.String),
});
export type MajordomeRoutineRun = typeof MajordomeRoutineRun.Type;

/** A stretch of time, such as the week a calendar shows: from `from` up to `to`. */
export const MajordomeRoutineRunsInput = Schema.Struct({
  projectId: ProjectId,
  from: IsoDateTime,
  to: IsoDateTime,
});
export type MajordomeRoutineRunsInput = typeof MajordomeRoutineRunsInput.Type;

export const MajordomeRoutineRunsResult = Schema.Struct({
  runs: Schema.Array(MajordomeRoutineRun),
});
export type MajordomeRoutineRunsResult = typeof MajordomeRoutineRunsResult.Type;

/** A routine the owner can add in one step. */
export const MajordomeReadyRoutine = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: Schema.String,
  description: Schema.String,
  /** Its schedule in words. */
  when: Schema.String,
  /** A connection it cannot do its job without, by the name the owner knows. */
  needs: Schema.optional(Schema.String),
  /** The owner's topic it belongs to, whose conversation it would post in. */
  topicId: Schema.optional(TrimmedNonEmptyString),
});
export type MajordomeReadyRoutine = typeof MajordomeReadyRoutine.Type;

export const MajordomeReadyRoutinesInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeReadyRoutinesInput = typeof MajordomeReadyRoutinesInput.Type;

/** The ready-made routines this server has not been asked to add, or that were removed since. */
export const MajordomeReadyRoutinesResult = Schema.Struct({
  routines: Schema.Array(MajordomeReadyRoutine),
});
export type MajordomeReadyRoutinesResult = typeof MajordomeReadyRoutinesResult.Type;

export const MajordomeAddReadyRoutineInput = Schema.Struct({
  projectId: ProjectId,
  key: TrimmedNonEmptyString,
  /** The conversation it posts in, such as its topic's; without one it keeps a conversation of its own. */
  threadId: Schema.optional(ThreadId),
});
export type MajordomeAddReadyRoutineInput = typeof MajordomeAddReadyRoutineInput.Type;

export const MajordomeSetRoutineLimitsInput = Schema.Struct({
  projectId: ProjectId,
  limits: MajordomeRoutineLimits,
});
export type MajordomeSetRoutineLimitsInput = typeof MajordomeSetRoutineLimitsInput.Type;

/** `folder` null means a new folder in the default place; otherwise an absolute path on the server. */
export const MajordomeStartNotesInput = Schema.Struct({
  folder: Schema.NullOr(TrimmedNonEmptyString),
});
export type MajordomeStartNotesInput = typeof MajordomeStartNotesInput.Type;

export const MajordomeStartNotesResult = Schema.Struct({
  projectId: ProjectId,
  folder: Schema.String,
});
export type MajordomeStartNotesResult = typeof MajordomeStartNotesResult.Type;

export class MajordomeVaultError extends Schema.TaggedError<MajordomeVaultError>()(
  "MajordomeVaultError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
