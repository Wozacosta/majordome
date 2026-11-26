import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ChatAttachmentId } from "./chatAttachment.ts";

/**
 * One file of the Library: something kept in the notes folder that is not a note, or something
 * attached to a chat. Metadata only; the bytes are fetched through the asset routes when shown.
 */
export const MajordomeLibraryFile = Schema.Union([
  Schema.TaggedStruct("notes-file", {
    /** Relative to the vault, with `/` separators. */
    path: Schema.String,
    name: Schema.String,
    sizeBytes: NonNegativeInt,
    /** When it last changed. */
    at: IsoDateTime,
  }),
  Schema.TaggedStruct("chat-file", {
    attachmentId: ChatAttachmentId,
    name: Schema.String,
    mimeType: Schema.String,
    sizeBytes: NonNegativeInt,
    /** When its message was sent. */
    at: IsoDateTime,
    threadId: ThreadId,
    threadTitle: Schema.String,
  }),
]);
export type MajordomeLibraryFile = typeof MajordomeLibraryFile.Type;

export const MajordomeLibraryInput = Schema.Struct({
  projectId: ProjectId,
  /**
   * Leaves the notes folder out. A brain's notes are the same on each of its servers, its chats
   * are not: a client asks one server for everything and the others for their chats only.
   */
  chatsOnly: Schema.optional(Schema.Boolean),
});
export type MajordomeLibraryInput = typeof MajordomeLibraryInput.Type;

export const MajordomeLibraryResult = Schema.Struct({
  /** Newest first, capped. */
  files: Schema.Array(MajordomeLibraryFile),
  /** Every file there is, including what `files` leaves out. */
  total: NonNegativeInt,
});
export type MajordomeLibraryResult = typeof MajordomeLibraryResult.Type;

/** `message` is written for the owner. */
export class MajordomeLibraryError extends Schema.TaggedError<MajordomeLibraryError>()(
  "MajordomeLibraryError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
