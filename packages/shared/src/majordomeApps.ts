/**
 * The apps a person can connect from Majordome. Each has its own official MCP server that
 * accepts a program registering itself. Granola was signed in to for real before it was listed;
 * the others were listed after they accepted Majordome as a client, on 2026-11-28.
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
  {
    id: "atlassian",
    name: "Atlassian",
    address: "https://mcp.atlassian.com/v2/mcp",
    about: "Jira and Confluence",
  },
  {
    id: "canva",
    name: "Canva",
    address: "https://mcp.canva.com/mcp",
    about: "Designs and exports",
  },
  {
    id: "linear",
    name: "Linear",
    address: "https://mcp.linear.app/mcp",
    about: "Issues and projects",
  },
  {
    id: "notion",
    name: "Notion",
    address: "https://mcp.notion.com/mcp",
    about: "Pages and databases",
  },
];
