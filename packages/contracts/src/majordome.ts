import * as Schema from "effect/Schema";

import { PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MajordomeVaultHistoryInput = Schema.Struct({
  projectId: ProjectId,
  limit: Schema.optional(PositiveInt),
});
export type MajordomeVaultHistoryInput = typeof MajordomeVaultHistoryInput.Type;

export const MajordomeRoutineKind = Schema.Literals([
  "start-my-day",
  "review-my-week",
  "digest-my-inbox",
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
  /** For "Start my day": the start of the daily note it wrote, as plain lines. */
  dailyNotePreview: Schema.optional(Schema.NullOr(Schema.String)),
});
export type MajordomeVaultHistoryEntry = typeof MajordomeVaultHistoryEntry.Type;

/** Which server runs the vault's routines: this one, another one, or none yet. */
export const MajordomeRoutinesRunner = Schema.Literals(["this-server", "another-server", "none"]);
export type MajordomeRoutinesRunner = typeof MajordomeRoutinesRunner.Type;

export const MajordomeVaultHistoryResult = Schema.Struct({
  isVault: Schema.Boolean,
  entries: Schema.Array(MajordomeVaultHistoryEntry),
  routinesRunner: MajordomeRoutinesRunner,
  /** The vault's daily and inbox folders, from its config. */
  folders: Schema.optional(Schema.Struct({ daily: Schema.String, inbox: Schema.String })),
  /**
   * The Markdown notes these entries touched that still exist, each with its first `# heading`
   * (null when it has none).
   */
  notes: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
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

export class MajordomeVaultError extends Schema.TaggedError<MajordomeVaultError>()(
  "MajordomeVaultError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
