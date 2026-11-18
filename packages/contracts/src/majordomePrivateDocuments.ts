import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";

/** One private document may be this large; the whole file is encrypted and decrypted in memory. */
export const MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX = 120;
export const MAJORDOME_PRIVATE_DOCUMENT_DESCRIPTION_MAX = 300;
export const MAJORDOME_PRIVATE_DOCUMENT_REASON_MAX = 500;

export const MajordomePrivateDocumentId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
export type MajordomePrivateDocumentId = typeof MajordomePrivateDocumentId.Type;

/** The topic a private document is kept with, on the machine that holds both. */
export const MajordomePrivateDocumentTopic = Schema.Struct({
  projectId: ProjectId,
  topicId: TrimmedNonEmptyString,
});
export type MajordomePrivateDocumentTopic = typeof MajordomePrivateDocumentTopic.Type;

/** What is known about a private document without opening it. Never its content. */
export const MajordomePrivateDocument = Schema.Struct({
  id: MajordomePrivateDocumentId,
  /** The owner's name for it, which agents ask for it by. */
  name: TrimmedNonEmptyString,
  description: Schema.String,
  fileName: TrimmedNonEmptyString,
  mediaType: Schema.String,
  sizeBytes: Schema.Number,
  addedAt: IsoDateTime,
  /** Absent for a document kept with no topic, and for those added before topics had files. */
  topic: Schema.optional(MajordomePrivateDocumentTopic),
});
export type MajordomePrivateDocument = typeof MajordomePrivateDocument.Type;

/**
 * How one access ended. `allowed`, `denied`, `timed_out` and `cancelled` (the run ended before an
 * answer) close an agent's request; the others are the owner's own actions.
 */
export const MajordomePrivateDocumentAccessOutcome = Schema.Literals([
  "allowed",
  "denied",
  "timed_out",
  "cancelled",
  "owner_viewed",
  "added",
  "removed",
]);
export type MajordomePrivateDocumentAccessOutcome =
  typeof MajordomePrivateDocumentAccessOutcome.Type;

/** One line of the access log. It names the document and who asked, never what the document says. */
export const MajordomePrivateDocumentAccess = Schema.Struct({
  at: IsoDateTime,
  documentId: MajordomePrivateDocumentId,
  documentName: Schema.String,
  outcome: MajordomePrivateDocumentAccessOutcome,
  /** The conversation or routine run that asked; absent for the owner's own actions. */
  requester: Schema.optional(Schema.Struct({ threadId: ThreadId, title: Schema.String })),
  /** The reason the agent gave. */
  reason: Schema.optional(Schema.String),
});
export type MajordomePrivateDocumentAccess = typeof MajordomePrivateDocumentAccess.Type;

export const MajordomePrivateDocumentsResult = Schema.Struct({
  documents: Schema.Array(MajordomePrivateDocument),
  /** Newest first, the most recent few hundred. */
  accessLog: Schema.Array(MajordomePrivateDocumentAccess),
});
export type MajordomePrivateDocumentsResult = typeof MajordomePrivateDocumentsResult.Type;

export const MajordomeAddPrivateDocumentInput = Schema.Struct({
  /** A pending upload from `attachments.createUploadUrl`; the server encrypts it and deletes it. */
  attachmentId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX)),
  description: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAJORDOME_PRIVATE_DOCUMENT_DESCRIPTION_MAX)),
  ),
  fileName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mediaType: Schema.String.check(Schema.isMaxLength(255)),
  topic: Schema.optional(MajordomePrivateDocumentTopic),
});
export type MajordomeAddPrivateDocumentInput = typeof MajordomeAddPrivateDocumentInput.Type;

export const MajordomePrivateDocumentInput = Schema.Struct({ id: MajordomePrivateDocumentId });
export type MajordomePrivateDocumentInput = typeof MajordomePrivateDocumentInput.Type;

/** A short-lived link to the decrypted file, relative to the server's HTTP address. */
export const MajordomeViewPrivateDocumentResult = Schema.Struct({
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
});
export type MajordomeViewPrivateDocumentResult = typeof MajordomeViewPrivateDocumentResult.Type;

/** Names the card an agent's request shows in its conversation. */
export const MajordomePrivateDocumentRequestInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
});
export type MajordomePrivateDocumentRequestInput = typeof MajordomePrivateDocumentRequestInput.Type;

/** An agent's request to open one document, waiting for the owner. */
export const MajordomePrivateDocumentRequest = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  documentId: MajordomePrivateDocumentId,
  documentName: Schema.String,
  /** The conversation or routine run that asks. */
  threadTitle: Schema.String,
  reason: Schema.String,
  requestedAt: IsoDateTime,
  /** With no answer by then, the request is denied. */
  expiresAt: IsoDateTime,
});
export type MajordomePrivateDocumentRequest = typeof MajordomePrivateDocumentRequest.Type;

export const MajordomeAnswerPrivateDocumentRequestInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  /** Allow opens the document once, for this run only. */
  allow: Schema.Boolean,
});
export type MajordomeAnswerPrivateDocumentRequestInput =
  typeof MajordomeAnswerPrivateDocumentRequestInput.Type;

/** What each failure says to the owner. Clients read it by `reason`. */
export const MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES = {
  not_found: "That document is no longer here.",
  upload_missing: "The upload did not arrive. Try adding the document again.",
  too_large: "That file is too large. Private documents can be up to 25 MB.",
  empty: "That file is empty.",
  name_taken: "Another private document already has that name.",
  key_unavailable: "Majordome could not reach the key that protects private documents.",
  storage_failed: "Majordome could not read or write its private documents folder.",
  decrypt_failed: "Majordome could not open that document with this machine's key.",
  request_closed: "This request is no longer waiting for an answer.",
  agent_stopped: "The assistant that asked has stopped, so there is nothing to open it for.",
  thread_unavailable: "Majordome could not read that conversation.",
} as const;

export const MajordomePrivateDocumentFailureReason = Schema.Literals(
  Object.keys(MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES) as Array<
    keyof typeof MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES
  >,
);
export type MajordomePrivateDocumentFailureReason =
  typeof MajordomePrivateDocumentFailureReason.Type;

export class MajordomePrivateDocumentError extends Schema.TaggedError<MajordomePrivateDocumentError>()(
  "MajordomePrivateDocumentError",
  {
    reason: MajordomePrivateDocumentFailureReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES[this.reason];
  }
}
