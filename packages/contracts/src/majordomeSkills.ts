import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

/** A skill's folder name: what the assistant calls it. */
const MajordomeSkillName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(64),
);

export const MajordomeSkillsInput = Schema.Struct({ projectId: ProjectId });
export type MajordomeSkillsInput = typeof MajordomeSkillsInput.Type;

/**
 * Where a skill's text comes from, as the notes' history tells it: the assistant wrote it, it came
 * with Majordome, or neither is known (put there by hand, or by another tool).
 */
export const MajordomeSkillSource = Schema.Literals(["assistant", "majordome", "other"]);
export type MajordomeSkillSource = typeof MajordomeSkillSource.Type;

export const MajordomeSkill = Schema.Struct({
  name: Schema.String,
  /** When the assistant uses it, from the skill's own header; empty when it has none. */
  description: Schema.String,
  /** The instructions themselves, cut when very long. */
  text: Schema.String,
  /** A server from before this field says nothing, which reads as "other". */
  source: MajordomeSkillSource.pipe(Schema.withDecodingDefault(Effect.succeed("other" as const))),
});
export type MajordomeSkill = typeof MajordomeSkill.Type;

export const MajordomeProposedSkill = Schema.Struct({
  ...MajordomeSkill.fields,
  /** True when keeping it replaces a skill of the same name. */
  replaces: Schema.Boolean,
  /** True when the owner stopped using it; false when it has never had their yes. */
  stopped: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type MajordomeProposedSkill = typeof MajordomeProposedSkill.Type;

export const MajordomeSkillsResult = Schema.Struct({
  isVault: Schema.Boolean,
  /** What the assistant wrote for itself and does not use until the owner keeps it. */
  proposed: Schema.Array(MajordomeProposedSkill),
  /** What the assistant uses, by name. */
  skills: Schema.Array(MajordomeSkill),
});
export type MajordomeSkillsResult = typeof MajordomeSkillsResult.Type;

export const MajordomeKeepSkillInput = Schema.Struct({
  projectId: ProjectId,
  name: MajordomeSkillName,
});
export type MajordomeKeepSkillInput = typeof MajordomeKeepSkillInput.Type;

export const MajordomeRemoveSkillInput = Schema.Struct({
  projectId: ProjectId,
  name: MajordomeSkillName,
  /** True deletes one that waits; false stops using one, which then waits to be kept again. */
  proposed: Schema.Boolean,
});
export type MajordomeRemoveSkillInput = typeof MajordomeRemoveSkillInput.Type;

/** `message` is written for the owner. */
export class MajordomeSkillsError extends Schema.TaggedError<MajordomeSkillsError>()(
  "MajordomeSkillsError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
