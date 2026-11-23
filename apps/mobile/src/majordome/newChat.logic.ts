interface NotesFolderRef {
  readonly environmentId: string;
  readonly projectId: string;
}

export type NewChatStart =
  | ({ readonly kind: "notes" } & NotesFolderRef)
  | { readonly kind: "looking" }
  | { readonly kind: "missing" }
  | { readonly kind: "draft" };

/**
 * Where a new chat starts: always the notes folder. A saved draft keeps the place it was written
 * for, and a folder not known yet is either still being asked for or not chosen on the computer.
 */
export function newChatStart(input: {
  readonly vault: NotesFolderRef | null;
  readonly resumesDraft: boolean;
  readonly stillLoading: boolean;
}): NewChatStart {
  if (input.resumesDraft) return { kind: "draft" };
  if (input.vault !== null) {
    return {
      kind: "notes",
      environmentId: String(input.vault.environmentId),
      projectId: String(input.vault.projectId),
    };
  }
  return { kind: input.stillLoading ? "looking" : "missing" };
}

/** Naming the computer only helps when there is another one to mean. */
export function showsComputerChoice(computerCount: number): boolean {
  return computerCount > 1;
}

/**
 * The line under a chat's title. The notes folder is the only place chats live, so it is never
 * named, and the computer is named only when there are several.
 */
export function chatSubtitle(input: {
  readonly computerLabel: string | null;
  readonly computerCount: number;
  /** Where the chat came from, when another chat or computer started it. */
  readonly origin: string | null;
}): string {
  return [showsComputerChoice(input.computerCount) ? input.computerLabel : null, input.origin]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}
