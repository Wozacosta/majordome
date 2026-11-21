import {
  EnvironmentId,
  type MajordomeBackupStatus,
  ProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { type AttentionInput, attentionCard } from "./attention.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const brain = ProjectId.make("brain");

const healthy: MajordomeBackupStatus = {
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
const paused: MajordomeBackupStatus = {
  ...healthy,
  paused: { reason: "conflict", files: [], since: "2026-11-15T00:00:00Z" },
};

const provider = (overrides: Record<string, unknown>): ServerProvider =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-15T08:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  }) as unknown as ServerProvider;
const signedOut = provider({ auth: { status: "unauthenticated" } });

/** One computer with one notes folder, and nothing wrong. */
const well: AttentionInput = {
  machines: [{ environmentId: mac, name: "This Mac", primary: true, connection: "connected" }],
  runners: [{ key: "brain", runner: "this-server", runsOn: null }],
  routines: [
    {
      key: "brain",
      runner: { environmentId: mac, machine: "This Mac" },
      routinesStatus: { ready: true },
      pausedRunsPerDay: null,
      memoryOverLimit: undefined,
    },
  ],
  notes: [{ environmentId: mac, projectId: brain, backup: healthy }],
  accounts: [{ environmentId: mac, providers: [provider({})] }],
};
const card = (overrides: Partial<AttentionInput>) => attentionCard({ ...well, ...overrides });

it("shows nothing when all is well, or while things are still being read or connecting", () => {
  expect(card({})).toBeNull();
  expect(
    card({
      machines: [{ ...well.machines[0]!, connection: "connecting" }],
      runners: [{ key: "brain", runner: null, runsOn: null }],
      accounts: [{ environmentId: mac, providers: null }],
      // "Not backed up yet" is a choice still to make, and a second AI left signed out is no problem.
      notes: [{ environmentId: mac, projectId: brain, backup: healthy }],
    }),
  ).toBeNull();
  expect(
    card({
      accounts: [
        {
          environmentId: mac,
          providers: [provider({}), { ...signedOut, instanceId: "codex" } as ServerProvider],
        },
      ],
    }),
  ).toBeNull();
});

it("says the one problem in a few words and leads to where it is fixed", () => {
  const cases: ReadonlyArray<[Partial<AttentionInput>, string, unknown]> = [
    [
      { notes: [{ environmentId: mac, projectId: brain, backup: paused }] },
      "Backup paused",
      { to: "/settings/backup" },
    ],
    [
      { accounts: [{ environmentId: mac, providers: [signedOut] }] },
      "Check your AI account",
      { to: "/settings/providers", search: { environmentId: mac } },
    ],
    [
      { accounts: [{ environmentId: mac, providers: [] }] },
      "Check your AI account",
      { to: "/settings/providers", search: { environmentId: mac } },
    ],
    [
      {
        routines: [
          {
            ...well.routines[0]!,
            routinesStatus: { ready: false, reason: "provider-unavailable", provider: "Claude" },
          },
        ],
      },
      "Routines can't run",
      { to: "/settings/providers", search: { environmentId: mac } },
    ],
    [
      { runners: [{ key: "brain", runner: "none", runsOn: null }] },
      "Routines aren't running",
      { to: "/feed" },
    ],
    [
      { routines: [{ ...well.routines[0]!, pausedRunsPerDay: 20 }] },
      "Routines paused for today",
      { to: "/routines" },
    ],
    [
      {
        machines: [
          ...well.machines,
          { environmentId: server, name: "Mac mini", primary: false, connection: "disconnected" },
        ],
      },
      "Can't reach Mac mini",
      { to: "/settings/connections" },
    ],
  ];
  for (const [overrides, text, link] of cases) {
    expect(card(overrides)).toEqual({ text, tone: "warning", link, count: 1 });
  }
});

it("turns red when this window's own computer cannot be reached", () => {
  expect(card({ machines: [{ ...well.machines[0]!, connection: "disconnected" }] })).toEqual({
    text: "Can't reach your computer",
    tone: "error",
    link: { to: "/settings/connections" },
    count: 1,
  });
});

it("counts several problems, takes the worst tone and leads to the Status page", () => {
  const several = {
    notes: [{ environmentId: mac, projectId: brain, backup: paused }],
    accounts: [{ environmentId: mac, providers: [signedOut] }],
  };
  expect(card(several)).toEqual({
    text: "2 things need you",
    tone: "warning",
    link: { to: "/settings/overview" },
    count: 2,
  });
  expect(
    card({ ...several, machines: [{ ...well.machines[0]!, connection: "disconnected" }] }),
  ).toEqual({
    text: "3 things need you",
    tone: "error",
    link: { to: "/settings/overview" },
    count: 3,
  });
});
