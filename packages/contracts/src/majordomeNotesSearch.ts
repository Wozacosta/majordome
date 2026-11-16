import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId } from "./baseSchemas.ts";

export const MAJORDOME_NOTES_SEARCH_QUERY_MAX = 200;
const MAJORDOME_NOTES_SEARCH_LIMIT_MAX = 50;

export const MajordomeNotesIndexInput = Schema.Struct({ projectId: ProjectId });
export type MajordomeNotesIndexInput = typeof MajordomeNotesIndexInput.Type;

export const MajordomeNotesSearchInput = Schema.Struct({
  projectId: ProjectId,
  /** Words a note must all hold; "quoted words" stay together; the last word may be unfinished. */
  query: Schema.String.check(Schema.isMaxLength(MAJORDOME_NOTES_SEARCH_QUERY_MAX)),
  /** Only notes in this folder of the vault, such as `projects/house`. */
  folder: Schema.optional(Schema.String.check(Schema.isMaxLength(1_000))),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAJORDOME_NOTES_SEARCH_LIMIT_MAX })),
  ),
});
export type MajordomeNotesSearchInput = typeof MajordomeNotesSearchInput.Type;

/** The search index of one vault on one server. */
export const MajordomeNotesIndexStatus = Schema.Struct({
  /** `building` until the first full pass ends; searches answer from what is indexed so far. */
  state: Schema.Literals(["building", "ready", "error"]),
  noteCount: Schema.Int,
  lastIndexedAt: Schema.NullOr(IsoDateTime),
  /** For `error`: what went wrong, in words for the owner. */
  reason: Schema.optional(Schema.String),
});
export type MajordomeNotesIndexStatus = typeof MajordomeNotesIndexStatus.Type;

export const MajordomeNotesSearchHit = Schema.Struct({
  /** Relative to the vault, with `/` separators. */
  path: Schema.String,
  title: Schema.String,
  /** The heading the snippet sits under, when it sits under one. */
  heading: Schema.NullOr(Schema.String),
  snippet: Schema.String,
  /** The matched words inside `snippet`, as `[start, end)` offsets. */
  highlights: Schema.Array(Schema.Struct({ start: Schema.Int, end: Schema.Int })),
  modifiedAt: IsoDateTime,
});
export type MajordomeNotesSearchHit = typeof MajordomeNotesSearchHit.Type;

/** `status` is null when the project is not a vault. */
export const MajordomeNotesSearchResult = Schema.Struct({
  results: Schema.Array(MajordomeNotesSearchHit),
  status: Schema.NullOr(MajordomeNotesIndexStatus),
});
export type MajordomeNotesSearchResult = typeof MajordomeNotesSearchResult.Type;

export const MajordomeNotesIndexResult = Schema.Struct({
  status: Schema.NullOr(MajordomeNotesIndexStatus),
});
export type MajordomeNotesIndexResult = typeof MajordomeNotesIndexResult.Type;

export class MajordomeNotesSearchError extends Schema.TaggedError<MajordomeNotesSearchError>()(
  "MajordomeNotesSearchError",
  {
    operation: Schema.Literals(["search", "status", "rebuild"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "search":
        return "Could not search the notes.";
      case "rebuild":
        return "Could not rebuild the notes search.";
      case "status":
        return "Could not read the notes search status.";
    }
  }
}
