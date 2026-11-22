import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

export const MajordomeKeyFactKind = Schema.Literals(["link", "place", "date", "person"]);
export type MajordomeKeyFactKind = typeof MajordomeKeyFactKind.Type;

/** Something worth finding again that a conversation mentioned. */
export const MajordomeKeyFact = Schema.Struct({
  kind: MajordomeKeyFactKind,
  /** The address, the place, the date or the name. */
  value: Schema.String,
  /** A few words on what it is, when the conversation says. */
  note: Schema.optional(Schema.String),
});
export type MajordomeKeyFact = typeof MajordomeKeyFact.Type;

export const MajordomeKeyFactsInput = Schema.Struct({ threadId: ThreadId });
export type MajordomeKeyFactsInput = typeof MajordomeKeyFactsInput.Type;

export const MajordomeKeyFactsResult = Schema.Struct({
  /** In the order the conversation brought them up. */
  facts: Schema.Array(MajordomeKeyFact),
  /** The conversation in a few lines: what was asked, what was settled, what is still open. */
  summary: Schema.Array(Schema.String),
  /** The last drawing made of the conversation, as Mermaid source. */
  diagram: Schema.NullOr(Schema.String),
});
export type MajordomeKeyFactsResult = typeof MajordomeKeyFactsResult.Type;

export const MajordomeDrawConversationInput = Schema.Struct({ threadId: ThreadId });
export type MajordomeDrawConversationInput = typeof MajordomeDrawConversationInput.Type;

export const MajordomeDrawConversationResult = Schema.Struct({
  /** Mermaid source. */
  diagram: Schema.String,
});
export type MajordomeDrawConversationResult = typeof MajordomeDrawConversationResult.Type;

/** `message` is written for the owner. */
export class MajordomeDrawConversationError extends Schema.TaggedError<MajordomeDrawConversationError>()(
  "MajordomeDrawConversationError",
  { message: Schema.String },
) {}
