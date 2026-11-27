import type { ClaudeSignInResult } from "@t3tools/contracts";

export interface ClaudeSignInNote {
  readonly tone: "ok" | "warning";
  readonly text: string;
}

/**
 * What to tell the owner once signed in. A sign-in token outranks the new sign-in for as long as
 * Claude sees one, so each note says what became of it, or exactly what is left to remove.
 */
export function claudeSignInNotes(result: ClaudeSignInResult): ReadonlyArray<ClaudeSignInNote> {
  const notes: Array<ClaudeSignInNote> = [];
  if (result.savedToken === "removed") {
    notes.push({
      tone: "ok",
      text: "The sign-in token that was saved here has been removed, so Claude uses this sign-in.",
    });
  }
  if (result.savedToken === "stillSet") {
    notes.push({
      tone: "warning",
      text: "A sign-in token is still saved below, and Claude keeps using it instead. Remove it from Claude sign-in token to use this sign-in and its connectors.",
    });
  }
  if (result.serverToken === "ignored") {
    notes.push({
      tone: "ok",
      text: "This server also has a sign-in token in its own settings (CLAUDE_CODE_OAUTH_TOKEN). Majordome now leaves it out, so Claude uses this sign-in.",
    });
  }
  if (result.serverToken === "stillSet") {
    notes.push({
      tone: "warning",
      text: "This server has a sign-in token in its own settings, and Claude keeps using it instead. Remove the CLAUDE_CODE_OAUTH_TOKEN line from the server's .env file, then restart the server.",
    });
  }
  return notes;
}
