import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES } from "./majordomePrivateDocuments.ts";

/** One file kept with a topic may be this large, the same as a private document. */
export const MAJORDOME_TOPIC_FILE_MAX_BYTES = MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES;
export const MAJORDOME_TOPIC_FILE_TOO_LARGE = "That file is too large. Files can be up to 25 MB.";

const VaultPath = Schema.String.check(Schema.isMaxLength(4_096));

/** A document kept in a topic's folder beside its notes: anything that is not Markdown. */
export const MajordomeTopicFile = Schema.Struct({
  /** Relative to the vault, with `/` separators. */
  path: Schema.String,
  name: Schema.String,
  sizeBytes: NonNegativeInt,
  modifiedAt: IsoDateTime,
});
export type MajordomeTopicFile = typeof MajordomeTopicFile.Type;

export const MajordomeTopicFilesInput = Schema.Struct({
  projectId: ProjectId,
  topicId: TrimmedNonEmptyString,
});
export type MajordomeTopicFilesInput = typeof MajordomeTopicFilesInput.Type;

export const MajordomeTopicFilesResult = Schema.Struct({
  /** Most recently changed first, capped. */
  files: Schema.Array(MajordomeTopicFile),
  /** Every file of the topic, including what `files` leaves out. */
  total: NonNegativeInt,
  /** True once the vault's saved history passes about 1 GB, which is what a backup sends. */
  large: Schema.Boolean,
});
export type MajordomeTopicFilesResult = typeof MajordomeTopicFilesResult.Type;

export const MajordomeAddTopicFileInput = Schema.Struct({
  projectId: ProjectId,
  topicId: TrimmedNonEmptyString,
  /** A pending upload from `attachments.createUploadUrl`; the server moves it into the folder. */
  attachmentId: TrimmedNonEmptyString,
  fileName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
});
export type MajordomeAddTopicFileInput = typeof MajordomeAddTopicFileInput.Type;

export const MajordomeTopicFileInput = Schema.Struct({
  projectId: ProjectId,
  /** As listed: relative to the vault. */
  path: VaultPath,
});
export type MajordomeTopicFileInput = typeof MajordomeTopicFileInput.Type;

/** A short-lived link to the file, relative to the server's HTTP address. */
export const MajordomeViewTopicFileResult = Schema.Struct({
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
});
export type MajordomeViewTopicFileResult = typeof MajordomeViewTopicFileResult.Type;

/** `message` is written for the owner. */
export class MajordomeTopicFilesError extends Schema.TaggedError<MajordomeTopicFilesError>()(
  "MajordomeTopicFilesError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
