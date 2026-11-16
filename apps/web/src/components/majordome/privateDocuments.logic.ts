import {
  MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES,
  MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES,
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  type MajordomePrivateDocument,
  type MajordomePrivateDocumentAccess,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";

/** "passport_scan-2031.PDF" is offered as "passport scan 2031"; the owner can change it. */
export function defaultDocumentName(fileName: string): string {
  const name = fileName
    .replace(/\.[A-Za-z0-9]{1,10}$/, "")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX);
  return name === "" ? "Document" : name;
}

/** Why this file cannot be added, in the owner's words, or null when it can. */
export function fileProblem(file: { readonly size: number }): string | null {
  if (file.size === 0) return MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES.empty;
  if (file.size > MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES) {
    return MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES.too_large;
  }
  return null;
}

/** Why this name cannot be used, or null. Names are how the assistant asks, so each is unique. */
export function nameProblem(
  name: string,
  documents: ReadonlyArray<Pick<MajordomePrivateDocument, "name">>,
): string | null {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return "Give the document a name.";
  return documents.some((document) => document.name.toLowerCase() === wanted)
    ? MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES.name_taken
    : null;
}

/** A failed private documents request, as the server words it. */
export function privateDocumentFailureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const { reason } = error;
    if (typeof reason === "string" && reason in MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES) {
      return MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES[
        reason as keyof typeof MAJORDOME_PRIVATE_DOCUMENT_FAILURE_MESSAGES
      ];
    }
  }
  return "Something went wrong. Try again.";
}

export interface AccessLine {
  /** What happened, as a sentence about the document. */
  readonly what: string;
  /** The reason the assistant gave, for its requests. */
  readonly reason: string | null;
  readonly tone: "ok" | "neutral" | "warning";
}

/** One line of "Who opened what". Only `allowed` and `owner_viewed` mean the content was read. */
export function describeAccess(entry: MajordomePrivateDocumentAccess): AccessLine {
  const who = entry.requester === undefined ? "Your assistant" : `“${entry.requester.title}”`;
  const reason = entry.reason?.trim() || null;
  switch (entry.outcome) {
    case "allowed":
      return { what: `${who} opened it, after you allowed it.`, reason, tone: "ok" };
    case "denied":
      return { what: `${who} asked for it and you said no.`, reason, tone: "neutral" };
    case "timed_out":
      return {
        what: `${who} asked for it. Nobody answered for 24 hours, so it stayed closed.`,
        reason,
        tone: "warning",
      };
    case "cancelled":
      return {
        what: `${who} asked for it and stopped before an answer.`,
        reason,
        tone: "neutral",
      };
    case "owner_viewed":
      return { what: "You downloaded it.", reason: null, tone: "ok" };
    case "added":
      return { what: "You added it.", reason: null, tone: "neutral" };
    case "removed":
      return { what: "You removed it.", reason: null, tone: "neutral" };
  }
}

type SecretRequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "secret_request" }>;

/** The card an assistant's request for a private document shows in its conversation. */
export function isPrivateDocumentRequest(
  item: OrchestrationV2TurnItem,
): item is SecretRequestItem & { readonly delivery: "private_document" } {
  return item.type === "secret_request" && item.delivery === "private_document";
}

/** How an answered request reads in the conversation afterwards. */
export function requestOutcomeLabel(
  status: Exclude<SecretRequestItem["secretStatus"], "pending">,
): string {
  switch (status) {
    case "saved":
      return "Allowed once";
    case "declined":
      return "Not allowed";
    case "cancelled":
      return "Closed without an answer";
  }
}
