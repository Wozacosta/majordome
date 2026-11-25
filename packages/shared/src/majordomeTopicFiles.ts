// @effect-diagnostics globalDate:off -- A file's date is said in the reader's own locale and zone via Intl.
import type { MajordomePrivateDocument, MajordomeTopicFile, ProjectId } from "@t3tools/contracts";

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
  return rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
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

/** Whether a file is a note: Markdown lives among the topic's notes, not its files. */
export function isNoteFileName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name.trim());
}

/** "3 more files in this topic's folder", for what the capped list leaves out; opens the folder. */
export function moreFilesLine(total: number, shown: number): string | null {
  const more = total - shown;
  if (more <= 0) return null;
  return `${more} more ${more === 1 ? "file" : "files"} in this topic's folder`;
}
