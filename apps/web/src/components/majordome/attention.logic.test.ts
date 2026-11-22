import {
  EnvironmentId,
  type MajordomeBackupStatus,
  ProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { type AttentionInput, attentionCard, settledRunner } from "./attention.logic";

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
  runs: [],
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
    expect(card(overrides)).toEqual({ text, tone: "warning", link, count: 1, action: "Fix" });
  }
});

it("turns red when this window's own computer cannot be reached", () => {
  expect(card({ machines: [{ ...well.machines[0]!, connection: "disconnected" }] })).toEqual({
    text: "Can't reach your computer",
    tone: "error",
    link: { to: "/settings/connections" },
    count: 1,
    action: "Fix",
  });
});

it("speaks for what the Feed's dot used to: the assistant waiting, or unable to finish", () => {
  expect(card({ runs: [{ status: "waiting" }] })).toEqual({
    text: "The assistant is waiting for you",
    tone: "warning",
    link: { to: "/feed" },
    count: 1,
    action: "Open",
  });
  expect(card({ runs: [{ status: "failed" }] })).toMatchObject({
    text: "The assistant couldn't finish something",
    tone: "error",
    link: { to: "/feed" },
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
    action: "Open",
  });
  expect(
    card({ ...several, machines: [{ ...well.machines[0]!, connection: "disconnected" }] }),
  ).toEqual({
    text: "3 things need you",
    tone: "error",
    link: { to: "/settings/overview" },
    count: 3,
    action: "Open",
  });
});

it("waits for a new notes folder's computer to take its routines before calling them unrun", () => {
  const createdAt = "2026-11-22T09:00:12.000Z";
  const cases = [
    // The server has not looked at the folder it was just given.
    ["none", "2026-11-22T09:00", null],
    ["none", "2026-11-22T09:04", null],
    // It has had its look and nothing claimed them: the owner is told.
    ["none", "2026-11-22T09:06", "none"],
    ["none", "2026-11-23T09:00", "none"],
    // An answer that names a computer, or none yet, stands whatever the folder's age.
    ["this-server", "2026-11-22T09:00", "this-server"],
    ["another-server", "2026-11-22T09:00", "another-server"],
    [null, "2026-11-23T09:00", null],
  ] as const;
  for (const [runner, nowMinute, expected] of cases) {
    expect(settledRunner({ runner, createdAt, nowMinute })).toBe(expected);
  }
  // A date that cannot be read hides nothing.
  expect(settledRunner({ runner: "none", createdAt: "", nowMinute: "2026-11-22T09:00" })).toBe(
    "none",
  );
});

it("says nothing while routines are being made, and speaks when no AI account can make them", () => {
  const routines = (reason: "not-created" | "no-provider") => [
    { ...well.routines[0]!, routinesStatus: { ready: false, reason } },
  ];
  expect(card({ routines: routines("not-created") })).toBeNull();
  expect(card({ routines: routines("no-provider") })).toMatchObject({ text: "Routines can't run" });
});
