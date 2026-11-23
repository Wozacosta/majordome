/**
 * How a routine made on the phone starts out, the same as one made on the computer: it works in
 * the notes folder itself (no code checkout), keeps one conversation, and may edit notes while
 * anything else waits for the owner.
 */
export const MAJORDOME_ROUTINE_DRAFT = {
  workspace: "root",
  threadMode: "fresh_session",
  runtimeMode: "auto-accept-edits",
} as const;

/** The routine form's labels where upstream's single words are coding words. */
export const MAJORDOME_ROUTINE_LABELS = {
  section: "Routine",
  project: "Notes folder",
  thread: "Chat",
} as const;
