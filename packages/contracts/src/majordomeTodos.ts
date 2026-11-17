import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, ProjectId } from "./baseSchemas.ts";

const MAJORDOME_TODO_TEXT_MAX = 500;

export const MajordomeTodosInput = Schema.Struct({ projectId: ProjectId });
export type MajordomeTodosInput = typeof MajordomeTodosInput.Type;

/** One unticked checkbox of a note. */
export const MajordomeTodo = Schema.Struct({
  /** The checkbox's line in the note, counted from 1. */
  line: PositiveInt,
  /** What follows the box on that line. */
  text: Schema.String,
});
export type MajordomeTodo = typeof MajordomeTodo.Type;

export const MajordomeTodoNote = Schema.Struct({
  /** Relative to the vault, with `/` separators. */
  path: Schema.String,
  title: Schema.String,
  modifiedAt: IsoDateTime,
  /** The note's first open to-dos, in the note's order. */
  todos: Schema.Array(MajordomeTodo),
  /** Open to-dos of this note left out of `todos`. */
  more: NonNegativeInt,
});
export type MajordomeTodoNote = typeof MajordomeTodoNote.Type;

export const MajordomeTodosResult = Schema.Struct({
  isVault: Schema.Boolean,
  /** The most recently changed notes that hold open to-dos, newest first. */
  notes: Schema.Array(MajordomeTodoNote),
  /** Across the whole vault, including what `notes` leaves out. */
  totalOpen: NonNegativeInt,
  totalNotes: NonNegativeInt,
});
export type MajordomeTodosResult = typeof MajordomeTodosResult.Type;

export const MajordomeSetTodoDoneInput = Schema.Struct({
  projectId: ProjectId,
  path: Schema.String.check(Schema.isMaxLength(4_096)),
  line: PositiveInt,
  /** The to-do as it was listed; a line that no longer reads this way is left alone. */
  text: Schema.String,
  done: Schema.Boolean,
});
export type MajordomeSetTodoDoneInput = typeof MajordomeSetTodoDoneInput.Type;

export const MajordomeAddTodoInput = Schema.Struct({
  projectId: ProjectId,
  text: Schema.String.check(Schema.isMaxLength(MAJORDOME_TODO_TEXT_MAX)),
});
export type MajordomeAddTodoInput = typeof MajordomeAddTodoInput.Type;

/** `message` is written for the owner. */
export class MajordomeTodosError extends Schema.TaggedError<MajordomeTodosError>()(
  "MajordomeTodosError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
