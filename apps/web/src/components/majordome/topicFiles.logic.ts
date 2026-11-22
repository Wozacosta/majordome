import {
  type EnvironmentId,
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  MAJORDOME_TOPIC_FILE_TOO_LARGE,
  type MajordomePrivateDocument,
  type MajordomeTopicFile,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

import { defaultDocumentName } from "./privateDocuments.logic";
import type { MajordomeVault, VaultTopic } from "./topics.logic";

export interface ThreadTopic {
  readonly projectId: ProjectId;
  readonly topic: VaultTopic;
}

/**
 * The topic whose conversation this thread is, on the thread's own server, when the topic's folder
 * is still there. `copies` are each server's own copy, not the merged brains: a file goes to the
 * folder on the machine that holds the conversation.
 */
export function topicOfThread(
  copies: ReadonlyArray<Pick<MajordomeVault, "environmentId" | "projectId" | "topics">>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ThreadTopic | null {
  for (const copy of copies) {
    if (copy.environmentId !== environmentId) continue;
    const topic = copy.topics.find((candidate) => candidate.threadId === threadId);
    if (topic !== undefined) {
      return topic.folderExists ? { projectId: copy.projectId, topic } : null;
    }
  }
  return null;
}

export type TopicFileRow =
  | {
      readonly kind: "file";
      readonly key: string;
      readonly name: string;
      readonly sizeBytes: number;
      /** When it last changed. */
      readonly at: string;
      readonly path: string;
    }
  | {
      readonly kind: "private";
      readonly key: string;
      readonly name: string;
      readonly sizeBytes: number;
      /** When it was added. */
      readonly at: string;
      readonly document: MajordomePrivateDocument;
    };

/** The topic's files and the private documents kept with it, most recently changed first. */
export function topicFileRows(
  files: ReadonlyArray<MajordomeTopicFile>,
  privateDocuments: ReadonlyArray<MajordomePrivateDocument>,
  where: { readonly projectId: ProjectId; readonly topicId: string },
): ReadonlyArray<TopicFileRow> {
  const rows: Array<TopicFileRow> = files.map((file) => ({
    kind: "file",
    key: `file:${file.path}`,
    name: file.name,
    sizeBytes: file.sizeBytes,
    path: file.path,
    at: file.modifiedAt,
  }));
  for (const document of privateDocuments) {
    if (document.topic?.projectId !== where.projectId || document.topic.topicId !== where.topicId) {
      continue;
    }
    rows.push({
      kind: "private",
      key: `private:${document.id}`,
      name: document.fileName,
      sizeBytes: document.sizeBytes,
      document,
      at: document.addedAt,
    });
  }
  return rows.toSorted((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/** True for a file a browser shows as it is in a tab: a PDF, a picture, plain text. */
export function topicFilePreviewable(name: string): boolean {
  return /\.(?:pdf|png|jpe?g|gif|webp|txt)$/i.test(name);
}

/** "3 Nov" beside a file's size, with the year once it is not this one. */
export function topicFileDate(
  iso: string,
  nowMs: number,
  locale?: string,
  timeZone?: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const zone = timeZone === undefined ? {} : { timeZone };
  const year = (date: Date) =>
    new Intl.DateTimeFormat("en", { year: "numeric", ...zone }).format(date);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(year(at) === year(new Date(nowMs)) ? {} : { year: "numeric" }),
    ...zone,
  }).format(at);
}

/** Why this file cannot be added, in the owner's words, or null when it can. */
/** Whether a file is a note: Markdown lives among the topic's notes, not its files. */
export function isNoteFileName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name.trim());
}

export function topicFileProblem(file: { readonly size: number }): string | null {
  if (file.size === 0) return "That file is empty.";
  return file.size > MAJORDOME_TOPIC_FILE_MAX_BYTES ? MAJORDOME_TOPIC_FILE_TOO_LARGE : null;
}

/**
 * The name a file kept private gets: read from its file name, with a number when another private
 * document already has it, since the assistant asks for one by name.
 */
export function privateDocumentNameFor(
  fileName: string,
  documents: ReadonlyArray<Pick<MajordomePrivateDocument, "name">>,
): string {
  const taken = new Set(documents.map((document) => document.name.toLowerCase()));
  // Room for the number within the longest name a private document may have.
  const base = defaultDocumentName(fileName)
    .slice(0, MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX - 4)
    .trim();
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "3 more files in this topic's folder", for what the capped list leaves out; opens the folder. */
export function moreFilesLine(total: number, shown: number): string | null {
  const more = total - shown;
  if (more <= 0) return null;
  return `${more} more ${more === 1 ? "file" : "files"} in this topic's folder`;
}
