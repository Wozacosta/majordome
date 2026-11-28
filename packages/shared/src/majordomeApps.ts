/**
 * The apps a person can connect from Majordome: each has its own MCP server and lets a program
 * register itself. Before listing one, open its approval page with our return address: Canva
 * registered any address, then refused all but the computer's own.
 */

export interface MajordomeAppEntry {
  /** Lower-case letters and digits: it starts the names of the app's tools. */
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly about: string;
  /** The app returns a sign-in only to the computer the browser is on, never to a web address. */
  readonly thisComputerOnly?: true;
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
    thisComputerOnly: true,
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
