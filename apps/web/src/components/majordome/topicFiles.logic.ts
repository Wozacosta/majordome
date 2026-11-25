import {
  type EnvironmentId,
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  MAJORDOME_TOPIC_FILE_TOO_LARGE,
  type MajordomePrivateDocument,
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

/** True for a file a browser shows as it is in a tab: a PDF, a picture, plain text. */
export function topicFilePreviewable(name: string): boolean {
  return /\.(?:pdf|png|jpe?g|gif|webp|txt)$/i.test(name);
}

/** Why this file cannot be added, in the owner's words, or null when it can. */
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
