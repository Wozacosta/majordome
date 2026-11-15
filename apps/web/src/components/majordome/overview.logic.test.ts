import type {
  DesktopBackgroundServiceState,
  MajordomeBackupStatus,
  ScheduledTask,
  ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  backupBox,
  brainBox,
  devicesBox,
  backgroundRunningLine,
  majordomeBox,
  OVERVIEW_TONE_DOT_CLASS,
  type OverviewBox,
  worstTone,
} from "./overview.logic";

const lineTones = (box: OverviewBox) =>
  Object.fromEntries(box.lines.map((line) => [line.key, line.tone]));

describe("tones", () => {
  it("uses the sidebar's colors: orange for attention, red for failure", () => {
    expect(OVERVIEW_TONE_DOT_CLASS.warning).toBe("bg-warning");
    expect(OVERVIEW_TONE_DOT_CLASS.error).toBe("bg-destructive");
  });

  it("takes the most serious tone, and never lets neutral hide ok", () => {
    expect(worstTone([])).toBe("neutral");
    expect(worstTone(["neutral", "ok"])).toBe("ok");
    expect(worstTone(["ok", "warning", "neutral"])).toBe("warning");
    expect(worstTone(["warning", "error", "ok"])).toBe("error");
  });
});

describe("devicesBox", () => {
  const devices = [
    { endpoint: "https://push/this", label: "Mac · Chrome", addedAt: null },
    { endpoint: "https://push/phone", label: "iPhone · Safari", addedAt: null },
  ];

  it("shows this device once, with the other devices that get notifications", () => {
    const box = devicesBox({ support: "supported", thisEndpoint: "https://push/this", devices });
    expect(box.lines.map((line) => [line.text, line.detail])).toEqual([
      ["This device", "Notifications on"],
      ["iPhone · Safari", "Gets notifications"],
    ]);
    expect(box.tone).toBe("ok");
  });

  it("is never orange for notifications nobody turned on", () => {
    const box = devicesBox({ support: "needs-home-screen", thisEndpoint: null, devices: [] });
    expect(box.tone).toBe("neutral");
    expect(box.lines.map((line) => line.key)).toEqual(["this", "none"]);
  });
});

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

describe("majordomeBox", () => {
  const phone = { tailscale: "ready" as const, secureUrl: "https://mac.ts.net", wifiUrls: [] };

  it("lists the AIs that are installed, and the phone address", () => {
    const box = majordomeBox({
      connected: true,
      providers: [
        provider({}),
        provider({ instanceId: "codex", driver: "codex", auth: { status: "unauthenticated" } }),
        provider({ instanceId: "cursor", driver: "cursor", installed: false }),
      ] as ReadonlyArray<ServerProvider>,
      phone,
    });
    expect(box.lines.map((line) => [line.key, line.detail ?? null])).toEqual([
      ["running", null],
      ["provider:claudeAgent", "Ready"],
      ["provider:codex", "Signed out"],
      ["phone", "On, secure"],
    ]);
    expect(box.tone).toBe("ok");
  });

  it("turns orange when no AI can work, and red when Majordome can't be reached", () => {
    const signedOut = majordomeBox({
      connected: true,
      providers: [provider({ auth: { status: "unauthenticated" } })],
      phone: null,
    });
    expect(signedOut.tone).toBe("warning");
    expect(lineTones(signedOut)["no-ai"]).toBe("warning");
    expect(majordomeBox({ connected: false, providers: null, phone }).tone).toBe("error");
  });

  it("says whether it keeps running once the window closes", () => {
    const since = (iso: string) => iso.slice(11, 16);
    const background: DesktopBackgroundServiceState = {
      supported: true,
      enabled: true,
      running: true,
      runningSince: "2026-11-15T08:00:00.000Z",
      logPath: "/Users/alice/.majordome/userdata/logs/majord.log",
    };
    const text = (state: DesktopBackgroundServiceState | null) => {
      const line = backgroundRunningLine(state, since);
      return [line.text, line.tone];
    };
    expect(text(background)).toEqual(["Running in the background since 08:00", "ok"]);
    expect(text({ ...background, runningSince: null })).toEqual([
      "Running in the background",
      "ok",
    ]);
    expect(text({ ...background, running: false, runningSince: null })).toEqual([
      "Stopped",
      "warning",
    ]);
    expect(text({ ...background, enabled: false })).toEqual([
      "Running while the window is open",
      "neutral",
    ]);
    // A browser or the phone has no background service to report.
    expect(text(null)).toEqual(["Running", "ok"]);
    expect(text({ ...background, supported: false })).toEqual(["Running", "ok"]);
  });
});

const task = (overrides: Record<string, unknown>): ScheduledTask =>
  ({
    id: "start-my-day",
    title: "Start my day",
    enabled: true,
    schedule: { type: "fixed", time: "08:00" },
    nextRunAt: "2026-11-16T08:00:00.000Z",
    lastRunStatus: "succeeded",
    ...overrides,
  }) as unknown as ScheduledTask;

describe("brainBox", () => {
  const base = {
    key: "local:brain",
    title: "brain",
    link: { to: "/notes" as const },
    runner: "this-server" as const,
    routines: [task({})],
    waiting: 0,
    failed: 0,
    formatNextRun: () => "tomorrow at 8:00",
  };

  it("says nothing waits, where routines run and when each runs next", () => {
    const box = brainBox(base);
    expect(box.lines.map((line) => [line.text, line.detail ?? null])).toEqual([
      ["Nothing waiting for you", null],
      ["Routines run on this computer", "Only while it's awake. Move them to an always-on server"],
      ["Start my day", "Next tomorrow at 8:00"],
    ]);
    expect(box.tone).toBe("ok");
    const shared = brainBox({ ...base, runner: "another-server", runsOn: "Always-on server" });
    expect(shared.lines[1]?.text).toBe("Routines run on Always-on server");
  });

  it("matches the Feed's dot: orange when a run waits, red when one couldn't finish", () => {
    expect(brainBox({ ...base, waiting: 2 }).tone).toBe("warning");
    expect(brainBox({ ...base, waiting: 1, failed: 1 }).tone).toBe("error");
    expect(brainBox({ ...base, runner: "none" }).tone).toBe("warning");
    expect(brainBox({ ...base, runner: "another-server" }).tone).toBe("ok");
  });

  it("marks a routine whose last run failed, and a switched-off one as off", () => {
    const box = brainBox({
      ...base,
      routines: [
        task({ lastRunStatus: "failed" }),
        task({ id: "weekly", title: "Review my week", enabled: false }),
      ],
    });
    expect(box.lines.slice(2).map((line) => [line.detail, line.tone])).toEqual([
      ["Last run couldn't finish", "error"],
      ["Off", "neutral"],
    ]);
  });
});

const status: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: "2026-11-15T08:00:00.000Z",
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

const remote = {
  name: "origin",
  host: "github.com",
  isGitHub: true,
  webUrl: null,
  syncing: true,
  backedUp: true,
  lastSyncedAt: "2026-11-15T08:00:00.000Z",
  lastError: null,
};

describe("backupBox", () => {
  const formatAgo = () => "5 min ago";

  it("is not orange for backups never set up, as in the sidebar", () => {
    const box = backupBox({ key: "brain", status, formatAgo });
    expect(lineTones(box)).toEqual({
      headline: "neutral",
      edits: "ok",
      remote: "neutral",
      folder: "neutral",
      drive: "neutral",
    });
    expect(box.tone).toBe("ok");
  });

  it("shows GitHub, the last save and the copies when all is well", () => {
    const box = backupBox({
      key: "brain",
      status: {
        ...status,
        remote,
        folder: {
          path: "/Volumes/USB",
          keep: 7,
          lastBackupAt: "2026-11-15T02:00:00.000Z",
          lastFile: null,
          lastError: null,
        },
      },
      formatAgo,
    });
    expect(box.lines.map((line) => [line.text, line.detail ?? null])).toEqual([
      ["Backed up to GitHub ✓", null],
      ["Your edits", "Last saved 5 min ago"],
      ["GitHub", "Backed up 5 min ago"],
      ["Folder copy", "Last copy 5 min ago"],
      ["Google Drive copy", "Not set up"],
    ]);
    expect(box.tone).toBe("ok");
  });

  it("turns orange when saving is paused or a chosen backup fails", () => {
    const paused = backupBox({
      key: "brain",
      status: {
        ...status,
        paused: { reason: "secret", files: ["a.md"], since: "2026-11-15T08:00:00.000Z" },
      },
      formatAgo,
    });
    expect(paused.tone).toBe("warning");
    expect(lineTones(paused).headline).toBe("warning");

    const failing = backupBox({
      key: "brain",
      status: {
        ...status,
        remote,
        drive: {
          lastBackupAt: null,
          lastFile: null,
          lastError: "Google Drive is full.",
          problem: "quota-full",
        },
      },
      formatAgo,
    });
    expect(lineTones(failing).drive).toBe("warning");
    expect(failing.tone).toBe("warning");
  });
});
