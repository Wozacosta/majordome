/**
 * The apps a person can connect from Majordome. Each has its own official MCP server that
 * accepts a program registering itself, and each was signed in to for real before it was listed.
 */

export interface MajordomeAppEntry {
  /** Lower-case letters and digits: it starts the names of the app's tools. */
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly about: string;
}

export const MAJORDOME_APPS: ReadonlyArray<MajordomeAppEntry> = [
  {
    id: "granola",
    name: "Granola",
    address: "https://mcp.granola.ai/mcp",
    about: "Meeting notes and transcripts",
  },
];
