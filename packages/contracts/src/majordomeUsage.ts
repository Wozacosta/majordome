import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";
import { UsageProviderKind } from "./usage.ts";

/**
 * What a share of the usage was for: one routine or reminder, one topic, the chats that belong to
 * no topic, or sessions this server's chats did not start (the same AI used in a terminal).
 */
export const MajordomeUsageUseKind = Schema.Literals(["routine", "topic", "chat", "outside"]);
export type MajordomeUsageUseKind = typeof MajordomeUsageUseKind.Type;

/** One use's totals over the asked window. */
export const MajordomeUsageUse = Schema.Struct({
  kind: MajordomeUsageUseKind,
  /** The scheduled task or topic; empty for the other kinds. */
  id: Schema.String,
  /** The routine's or topic's name; empty for the other kinds, and for one that is gone. */
  label: Schema.String,
  /** Turns started in the window; zero for `outside`, which has none here. */
  runs: NonNegativeInt,
  byProvider: Schema.Array(
    Schema.Struct({
      provider: UsageProviderKind,
      costUsd: Schema.Number,
      /** Input, cache reads, cache writes and output together. */
      tokens: NonNegativeInt,
    }),
  ),
});
export type MajordomeUsageUse = typeof MajordomeUsageUse.Type;

/** The same window as the usage summary, cut by use: totals only, one entry a use. */
export const MajordomeUsageByUse = Schema.Struct({
  uses: Schema.Array(MajordomeUsageUse),
});
export type MajordomeUsageByUse = typeof MajordomeUsageByUse.Type;
