import * as Schema from "effect/Schema";

const Families = Schema.Array(Schema.String);

/** One kind of AI account: the model families each level looks for, best first. */
export const ModelLevelFamilies = Schema.Struct({
  quick: Families,
  everyday: Families,
  powerful: Families,
});
export type ModelLevelFamilies = typeof ModelLevelFamilies.Type;

/**
 * Which models Majordome's three levels mean, per kind of AI account. A family is a piece of a
 * model's id. The server refreshes this from Majordome's repository, so a maker's new family
 * reaches an installed app without a release.
 */
export const ModelLevelTable = Schema.Struct({
  /** ISO date of the last change; a fetched table older than the one in hand is ignored. */
  updatedAt: Schema.String,
  drivers: Schema.Record(Schema.String, ModelLevelFamilies),
  /** For accounts that resell other makers' models, after their own row. */
  anyDriver: ModelLevelFamilies,
  /** Families that are deliberately no level, so the periodic check does not report them. */
  ignored: Families,
});
export type ModelLevelTable = typeof ModelLevelTable.Type;
