import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** What a saved item is, which decides how its length reads ("12 min read", "18 min"). */
export const MAJORDOME_READING_KINDS = [
  "article",
  "video",
  "paper",
  "repo",
  "podcast",
  "doc",
  "other",
] as const;
export const MajordomeReadingKind = Schema.Literals(MAJORDOME_READING_KINDS);
export type MajordomeReadingKind = typeof MajordomeReadingKind.Type;

/**
 * One thing the owner saved to read, watch or listen to later, as `.majordome/reading-list.json`
 * in the vault stores it. The list's order is the owner's.
 */
export const MajordomeReadingItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** Null for something saved by its title alone. */
  url: Schema.NullOr(Schema.String),
  title: TrimmedNonEmptyString,
  /** Where it is from: the site's host, or a video's channel. */
  site: Schema.optional(Schema.String),
  kind: MajordomeReadingKind,
  tags: Schema.Array(Schema.String),
  /** How long it takes to read, watch or hear, when that could be told. */
  minutes: Schema.optional(Schema.Number),
  /** One sentence on what it is about, written by the owner's AI when the link was saved. */
  summary: Schema.optional(Schema.String),
  /** The page's own picture (an https address), shown as the row's thumbnail. */
  image: Schema.optional(Schema.String),
  addedAt: Schema.String,
  /** Set once the owner finished it. */
  doneAt: Schema.optional(Schema.String),
  /**
   * "Not now": the day it comes back, as a calendar date (`2026-12-02`) read in the owner's own
   * time. Until that day starts the item is kept out of the list; no one has to wake it.
   */
  snoozedUntil: Schema.optional(Schema.String),
  starred: Schema.optional(Schema.Boolean),
  /** What the owner took from it, in their words. */
  notes: Schema.optional(Schema.String),
});
export type MajordomeReadingItem = typeof MajordomeReadingItem.Type;

export const MajordomeReadingListInput = Schema.Struct({
  projectId: ProjectId,
});
export type MajordomeReadingListInput = typeof MajordomeReadingListInput.Type;

export const MajordomeReadingListResult = Schema.Struct({
  isVault: Schema.Boolean,
  /** In the owner's order. */
  items: Schema.Array(MajordomeReadingItem),
});
export type MajordomeReadingListResult = typeof MajordomeReadingListResult.Type;

export const MajordomeAddReadingItemInput = Schema.Struct({
  projectId: ProjectId,
  /** A link, or a title for something without one. */
  text: TrimmedNonEmptyString,
});
export type MajordomeAddReadingItemInput = typeof MajordomeAddReadingItemInput.Type;

export const MajordomeAddReadingItemResult = Schema.Struct({
  item: MajordomeReadingItem,
  /** True when the link was already saved: nothing was added and `item` is the saved one. */
  duplicate: Schema.Boolean,
});
export type MajordomeAddReadingItemResult = typeof MajordomeAddReadingItemResult.Type;

/** Only the fields sent change. */
export const MajordomeUpdateReadingItemInput = Schema.Struct({
  projectId: ProjectId,
  itemId: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  kind: Schema.optional(MajordomeReadingKind),
  tags: Schema.optional(Schema.Array(Schema.String)),
  /** Null forgets the length. */
  minutes: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Finishing an item also ends its snooze. */
  done: Schema.optional(Schema.Boolean),
  /** A calendar date (`2026-12-02`) snoozes the item until that day; null wakes it now. */
  snoozedUntil: Schema.optional(Schema.NullOr(Schema.String)),
  starred: Schema.optional(Schema.Boolean),
  /** Null or empty removes the notes. */
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * Reads the link again for its picture, and for the source and length it still lacks. A video
   * or podcast gets its playing time, going by the kind sent here or else the item's own.
   */
  lookUp: Schema.optional(Schema.Boolean),
  /**
   * Also asks the owner's AI for tags and a one-line summary, kept only where the item has none.
   * Never fails the change: with no AI ready, or no usable answer, the item stays as it is.
   */
  enrich: Schema.optional(Schema.Boolean),
});
export type MajordomeUpdateReadingItemInput = typeof MajordomeUpdateReadingItemInput.Type;

export const MajordomeReorderReadingItemsInput = Schema.Struct({
  projectId: ProjectId,
  /** Every item id, in the new order. Ids it leaves out keep their place at the end. */
  itemIds: Schema.Array(TrimmedNonEmptyString),
});
export type MajordomeReorderReadingItemsInput = typeof MajordomeReorderReadingItemsInput.Type;

export const MajordomeReadingItemRefInput = Schema.Struct({
  projectId: ProjectId,
  itemId: TrimmedNonEmptyString,
});
export type MajordomeReadingItemRefInput = typeof MajordomeReadingItemRefInput.Type;

/** Puts back an item just removed, where it was: the way out of a removal. */
export const MajordomeRestoreReadingItemInput = Schema.Struct({
  projectId: ProjectId,
  item: MajordomeReadingItem,
  /** Its place in the list; past the end puts it last. */
  index: Schema.Number,
});
export type MajordomeRestoreReadingItemInput = typeof MajordomeRestoreReadingItemInput.Type;

export class MajordomeReadingListError extends Schema.TaggedError<MajordomeReadingListError>()(
  "MajordomeReadingListError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
