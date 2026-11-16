import {
  type MajordomeBackupStatus,
  type MajordomeConnectorsResult,
  type MajordomeProviderConnectors,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  aiRows,
  backupRows,
  connectorName,
  connectorState,
  connectorsView,
  isUnknownRequest,
} from "./connections.logic";

const snapshot = (id: string, overrides: Partial<ServerProvider> = {}): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make(id),
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...overrides,
  }) as ServerProvider;

const entry = (
  id: string,
  overrides: Partial<MajordomeProviderConnectors> = {},
): MajordomeProviderConnectors => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(id),
  reported: true,
  connectors: [],
  ...overrides,
});

const result = (
  ...providers: ReadonlyArray<MajordomeProviderConnectors>
): MajordomeConnectorsResult => ({ checkedAt: "2026-11-16T09:00:00.000Z", providers });

it.each([
  ["claude.ai Gmail", "Gmail"],
  ["claude.ai Google Calendar", "Google Calendar"],
  ["plugin:vercel:vercel", "vercel"],
  ["plugin:notes", "notes"],
  ["laterlist", "laterlist"],
  ["claude.ai ", "claude.ai"],
])("names the connector %s as %s", (raw, name) => {
  expect(connectorName(raw)).toBe(name);
});

it("words each connector status plainly", () => {
  expect(
    (["connected", "needs-auth", "failed", "disabled", "pending"] as const).map(
      (status) => connectorState(status).label,
    ),
  ).toEqual(["Connected", "Needs sign-in", "Not working", "Turned off", "Checking"]);
});

it("says whether each turned-on provider is signed in, in its own words when it is not working", () => {
  expect(
    aiRows([
      snapshot("claudeAgent"),
      snapshot("codex", { auth: { status: "unauthenticated" } }),
      snapshot("cursor", { status: "error", message: "Cursor CLI crashed." } as never),
      snapshot("opencode", { installed: false }),
      snapshot("grok", { enabled: false }),
    ]).map((row) => [row.name, row.state.label, row.state.detail]),
  ).toEqual([
    ["Claude", "Signed in", undefined],
    ["Codex", "Not signed in", undefined],
    ["Cursor", "Not working", "Cursor CLI crashed."],
    ["OpenCode", "Not installed", undefined],
  ]);
});

it("lists a machine's connectors under their friendly names", () => {
  const view = connectorsView({
    result: result(
      entry("claudeAgent", {
        connectors: [
          { name: "claude.ai Gmail", status: "connected" },
          { name: "plugin:vercel:vercel", status: "needs-auth" },
        ],
      }),
    ),
    snapshots: [snapshot("claudeAgent")],
    machine: null,
  });
  expect(view.rows.map((row) => [row.name, row.provider, row.state.label])).toEqual([
    ["Gmail", null, "Connected"],
    ["vercel", null, "Needs sign-in"],
  ]);
  expect(view.warnings).toEqual([]);
  expect(view.notes).toEqual([]);
});

it("says what a machine without connectors cannot do, naming it where several are shown", () => {
  const input = { result: result(entry("claudeAgent")), snapshots: [snapshot("claudeAgent")] };
  expect(connectorsView({ ...input, machine: null }).warnings).toEqual([
    "No connectors on this machine. Conversations and routines that run here can't reach your email, calendar or files.",
  ]);
  expect(connectorsView({ ...input, machine: "This Mac" }).warnings[0]).toMatch(
    /^No connectors on this Mac\./,
  );
  expect(connectorsView({ ...input, machine: "Home server" }).warnings[0]).toMatch(
    /^No connectors on Home server\./,
  );
});

it("leaves the missing connectors unsaid for a provider that is signed out", () => {
  const view = connectorsView({
    result: result(entry("claudeAgent")),
    snapshots: [snapshot("claudeAgent", { auth: { status: "unauthenticated" } })],
    machine: null,
  });
  expect(view).toEqual({ rows: [], warnings: [], notes: [] });
});

it("names the provider on each row and warning when several list connectors", () => {
  const view = connectorsView({
    result: result(
      entry("claudeAgent", { connectors: [{ name: "claude.ai Gmail", status: "connected" }] }),
      entry("claude-work", { displayName: "Work" }),
    ),
    snapshots: null,
    machine: null,
  });
  expect(view.rows.map((row) => row.provider)).toEqual(["Claude"]);
  expect(view.warnings).toEqual([
    "Work has no connectors on this machine. Conversations and routines that use it here can't reach your email, calendar or files.",
  ]);
});

it("reports a failed check, and in one line the providers whose connectors can't be seen", () => {
  const view = connectorsView({
    result: result(
      entry("claudeAgent", { error: "Claude took too long to list its connectors." }),
      entry("codex", { reported: false }),
      entry("cursor", { reported: false }),
      entry("opencode", { reported: false }),
    ),
    snapshots: [
      snapshot("claudeAgent"),
      snapshot("codex"),
      snapshot("cursor"),
      snapshot("opencode", { installed: false }),
    ],
    machine: null,
  });
  expect(view.warnings).toEqual([
    "Majordome couldn't check Claude's connectors. Claude took too long to list its connectors.",
  ]);
  expect(view.notes).toEqual(["Majordome can't see the connectors of Codex and Cursor."]);
});

it("tells an older server's answer from a real failure", () => {
  expect(isUnknownRequest("Unknown request tag: majordome.listConnectors")).toBe(true);
  expect(isUnknownRequest(new Error("The environment request failed."))).toBe(false);
});

const backup: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: null,
  saveError: null,
  paused: null,
  remote: null,
  folder: null,
  drive: null,
  hasPassphrase: false,
  googleDrive: { available: true, signedIn: false },
  github: { available: true, signedIn: false },
  secretScan: true,
};
const githubRemote = {
  name: "origin",
  host: "github.com",
  isGitHub: true,
  webUrl: null,
  syncing: true,
  backedUp: true,
  lastSyncedAt: null,
  lastError: null,
};
const drive = { lastBackupAt: null, lastFile: null, lastError: null, problem: null };

it("says where a machine's notes are backed up to", () => {
  const states = (
    statuses: ReadonlyArray<MajordomeBackupStatus>,
    elsewhere = false,
  ): ReadonlyArray<string> =>
    backupRows(statuses, { elsewhere }).map((row) => `${row.name}: ${row.state.label}`);

  expect(states([backup])).toEqual([
    "GitHub: Not set up",
    "Google Drive: Not set up",
    "Folder backup: Not set up",
  ]);
  expect(
    states([
      {
        ...backup,
        remote: githubRemote,
        github: { available: true, signedIn: true },
        drive,
        googleDrive: { available: true, signedIn: true },
        folder: { path: "/backups", keep: 7, lastBackupAt: null, lastFile: null, lastError: null },
      },
    ]),
  ).toEqual(["GitHub: Connected", "Google Drive: Connected", "Folder backup: Connected"]);
  // Notes cloned from GitHub onto a server push nowhere until someone signs in there; a folder
  // on a server isn't offered.
  expect(states([{ ...backup, remote: githubRemote, drive }], true)).toEqual([
    "GitHub: Needs sign-in",
    "Google Drive: Needs sign-in",
  ]);
  // One connected notes folder is enough for the machine to count as connected.
  expect(
    states([
      backup,
      { ...backup, remote: githubRemote, github: { available: true, signedIn: true } },
    ])[0],
  ).toBe("GitHub: Connected");
});
