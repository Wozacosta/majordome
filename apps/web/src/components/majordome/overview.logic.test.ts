import {
  type DesktopBackgroundServiceState,
  EnvironmentId,
  type MajordomeBackupStatus,
  type MajordomePrivateDocumentsResult,
  ProjectId,
  type ScheduledTask,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accessSection,
  backgroundRunningLine,
  needsYouLines,
  notesSection,
  type OverviewAccessMachine,
  type OverviewLine,
  type OverviewMachine,
  type OverviewNotesCopy,
  type OverviewRoutineBrain,
  OVERVIEW_TONE_DOT_CLASS,
  overviewVerdict,
  phoneSection,
  routinesSection,
  whereItRunsSection,
  worstTone,
} from "./overview.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const brain = ProjectId.make("brain");

const facts = (lines: ReadonlyArray<OverviewLine>) =>
  lines.map((line) => [line.text, line.detail ?? null, line.tone]);
const ready = <T>(value: T) => ({ state: "ready" as const, value });

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

describe("overviewVerdict", () => {
  const line = (key: string, tone: OverviewLine["tone"], count?: number): OverviewLine => ({
    key,
    text: key,
    tone,
    ...(count === undefined ? {} : { count }),
  });

  it("says everything works when nothing is orange or red", () => {
    const verdict = overviewVerdict(
      [],
      [{ lines: [line("a", "ok"), line("b", "neutral")], loading: false }],
    );
    expect(verdict).toEqual({ text: "Everything is working.", tone: "ok", items: [] });
  });

  it("does not say everything works while a part is still being read", () => {
    const verdict = overviewVerdict([], [{ lines: [line("a", "ok")], loading: true }]);
    expect([verdict.text, verdict.tone]).toEqual(["Checking…", "neutral"]);
  });

  it("counts what needs the owner, red first, then in the page's order with runs first", () => {
    const verdict = overviewVerdict(
      [line("runs:waiting", "warning", 2)],
      [
        { lines: [line("machine", "warning"), line("fine", "ok")], loading: true },
        { lines: [line("index", "error")], loading: false },
      ],
    );
    expect(verdict.text).toBe("4 things need you.");
    expect(verdict.tone).toBe("error");
    expect(verdict.items.map((item) => item.key)).toEqual(["index", "runs:waiting", "machine"]);
    expect(overviewVerdict([line("a", "warning")], []).text).toBe("1 thing needs you.");
  });
});

describe("needsYouLines", () => {
  it("sums runs by what happened, and leaves a private document request to its own line", () => {
    const lines = needsYouLines([
      { status: "waiting" },
      { status: "waiting" },
      { status: "waiting", privateDocumentRequest: true },
      { status: "failed" },
      { status: "stopped" },
    ]);
    expect(lines.map((line) => [line.text, line.tone, line.count])).toEqual([
      ["A run couldn't finish", "error", 1],
      ["A run was stopped: it ran too long", "error", 1],
      ["2 runs are waiting for you", "warning", 2],
    ]);
    expect(lines.every((line) => line.link?.to === "/feed")).toBe(true);
    expect(needsYouLines([])).toEqual([]);
  });
});

const since = (iso: string) => iso.slice(11, 16);
const background: DesktopBackgroundServiceState = {
  supported: true,
  enabled: true,
  running: true,
  runningSince: "2026-11-15T08:00:00.000Z",
  logPath: "/Users/alice/.majordome/userdata/logs/majord.log",
};

describe("backgroundRunningLine", () => {
  it("says whether it keeps running once the window closes", () => {
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

describe("whereItRunsSection", () => {
  const machine = (overrides: Partial<OverviewMachine>): OverviewMachine => ({
    environmentId: mac,
    label: null,
    primary: true,
    connection: "connected",
    version: "1.4.0",
    behind: false,
    ...overrides,
  });
  const base = { background: null, formatSince: since, runners: [] };

  it("shows one machine without its name, with where routines run", () => {
    const section = whereItRunsSection({
      ...base,
      background,
      machines: [machine({})],
      runners: [{ key: "brain", label: null, runner: "this-server", runsOn: null }],
    });
    expect(facts(section.lines)).toEqual([
      ["Running in the background since 08:00", "Version 1.4.0", "ok"],
      [
        "Routines run on this computer",
        "Only while it's awake. Move them to an always-on server",
        "ok",
      ],
    ]);
    expect(section.loading).toBe(false);
  });

  it("names each of several machines, and the one that runs routines", () => {
    const section = whereItRunsSection({
      ...base,
      machines: [
        machine({ label: "This Mac" }),
        machine({ environmentId: server, label: "Always-on server", primary: false }),
      ],
      runners: [
        { key: "brain", label: null, runner: "another-server", runsOn: "This Mac" },
        {
          key: "work",
          label: "Work",
          runner: "another-server",
          runsOn: "Always-on server",
          keepsConversations: true,
        },
      ],
    });
    expect(facts(section.lines)).toEqual([
      ["This Mac: Running", "Version 1.4.0", "ok"],
      ["Always-on server: Connected", "Version 1.4.0", "ok"],
      ["Routines run on this Mac", null, "ok"],
      [
        "Work: Routines run on Always-on server",
        "Chats are kept there too, so your phone shows the same ones.",
        "ok",
      ],
    ]);
  });

  it("keeps a machine that is away or older on the page, and says so", () => {
    const section = whereItRunsSection({
      ...base,
      machines: [
        machine({ label: "This Mac", connection: "disconnected" }),
        machine({ environmentId: server, label: "Server", primary: false, behind: true }),
        machine({ environmentId: EnvironmentId.make("b"), label: "B", connection: "connecting" }),
        machine({
          environmentId: EnvironmentId.make("c"),
          label: "C",
          primary: false,
          connection: "disconnected",
          version: null,
        }),
      ],
    });
    expect(section.lines.map((line) => [line.text, line.tone, line.link?.to ?? null])).toEqual([
      ["This Mac: Not reachable", "error", "/settings/connections"],
      ["Server: Connected", "warning", "/settings/connections"],
      ["B: Connecting…", "neutral", null],
      ["C: Not connected", "warning", "/settings/connections"],
    ]);
    expect(section.lines[1]?.detail).toBe(
      "Version 1.4.0 is older than this app. Update it so everything works together.",
    );
  });

  it("flags routines that run nowhere, and waits for what is not known yet", () => {
    const nowhere = whereItRunsSection({
      ...base,
      machines: [machine({})],
      runners: [{ key: "a", label: "Home", runner: "none", runsOn: null }],
    });
    expect(nowhere.lines[1]).toMatchObject({
      text: "Home: Routines don't run anywhere yet",
      tone: "warning",
    });
    expect(whereItRunsSection({ ...base, machines: [] }).loading).toBe(true);
    const unknown = whereItRunsSection({
      ...base,
      machines: [machine({})],
      runners: [{ key: "a", label: null, runner: null, runsOn: null }],
    });
    expect([unknown.lines.length, unknown.loading]).toEqual([1, true]);
  });
});

const task = (overrides: Record<string, unknown>): ScheduledTask =>
  ({
    id: "start-my-day",
    title: "Start my day",
    enabled: true,
    projectId: brain,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    nextRunAt: "2026-11-16T08:00:00.000Z",
    lastRunStatus: "succeeded",
    ...overrides,
  }) as unknown as ScheduledTask;

describe("routinesSection", () => {
  const routineBrain = (overrides: Partial<OverviewRoutineBrain>): OverviewRoutineBrain => ({
    key: "brain",
    label: null,
    runner: { environmentId: mac, machine: "This Mac" },
    routinesStatus: { ready: true },
    pausedRunsPerDay: null,
    limits: { runsPerDay: 20, runMinutes: 30 },
    memoryOverLimit: undefined,
    copies: [{ key: "mac:brain", label: null, tasks: ready({ tasks: [task({})] }) }],
    ...overrides,
  });
  const build = (brains: ReadonlyArray<OverviewRoutineBrain>, loading = false) =>
    routinesSection({ brains, loading, formatNextRun: () => "tomorrow at 8:00" });

  it("leaves out the routines kept on a computer that does not run them, but not its reminders", () => {
    const section = build([
      routineBrain({
        runner: { environmentId: mac, machine: "Always-on server" },
        copies: [
          { key: "server:brain", label: "Always-on server", tasks: ready({ tasks: [task({})] }) },
          {
            key: "mac:brain",
            label: "This Mac",
            runsRoutines: false,
            tasks: ready({
              tasks: [
                // Never ran here, so its copy reads as failed: not a problem, and not listed.
                task({ id: "tidy", title: "Tidy my memory", lastRunStatus: "failed" }),
                task({
                  id: "bank",
                  title: "Call the bank",
                  schedule: { type: "once", runAt: "2026-12-01T10:00:00.000Z" },
                  nextRunAt: "2026-12-01T10:00:00.000Z",
                  lastRunStatus: "never",
                }),
              ],
            }),
          },
        ],
      }),
    ]);
    const titles = section.lines.map((line) => line.text);
    expect(titles).toContain("Always-on server: Start my day");
    expect(titles).toContain("This Mac: Call the bank");
    expect(titles.join("|")).not.toContain("Tidy my memory");
    expect(section.lines.some((line) => line.tone === "error")).toBe(false);
  });

  it("gives each routine one line: when it runs, when next, how the last run went", () => {
    const section = build([
      routineBrain({
        copies: [
          {
            key: "mac:brain",
            label: null,
            tasks: ready({
              tasks: [
                task({}),
                task({ id: "week", title: "Review my week", lastRunStatus: "failed" }),
                task({ id: "tidy", title: "Tidy my memory", enabled: false }),
                task({
                  id: "inbox",
                  title: "Digest my inbox",
                  schedule: { type: "webhook", signature: null },
                  nextRunAt: null,
                  lastRunStatus: "never",
                }),
                // A reminder that went off stays stored, and is left out.
                task({
                  id: "rang",
                  title: "Call the bank",
                  schedule: { type: "once", runAt: "2026-11-01T10:00:00.000Z" },
                  nextRunAt: null,
                }),
              ],
            }),
          },
        ],
      }),
    ]);
    expect(facts(section.lines)).toEqual([
      ["Start my day", "Every day at 8:00 AM · Next tomorrow at 8:00 · Last run went well", "ok"],
      [
        "Review my week",
        "Every day at 8:00 AM · Next tomorrow at 8:00 · Last run couldn't finish",
        "error",
      ],
      ["Tidy my memory", "Off", "neutral"],
      ["Digest my inbox", "When something arrives", "neutral"],
      ["Up to 20 runs a day, 30 minutes each", null, "neutral"],
    ]);
    expect(section.lines[0]?.link).toEqual({ to: "/routines" });
  });

  it("says first when routines can't run, and sends the owner to that machine's providers", () => {
    const section = build([
      routineBrain({
        label: "Home",
        routinesStatus: { ready: false, reason: "provider-signed-out", provider: "Claude" },
        pausedRunsPerDay: 20,
      }),
    ]);
    expect(section.lines.slice(0, 2).map((line) => [line.text, line.tone, line.link])).toEqual([
      [
        "Home: Routines can't run: Claude is signed out on this Mac.",
        "warning",
        { to: "/settings/providers", search: { environmentId: mac } },
      ],
      [
        "Home: Routines are paused until tomorrow: they used today's 20 runs",
        "warning",
        { to: "/routines" },
      ],
    ]);
    // The paused line already gives the limit.
    expect(section.lines.some((line) => line.key.startsWith("limits:"))).toBe(false);
  });

  it("asks for the owner about a long memory note only when nothing shortens it tonight", () => {
    const tone = (tidyRoutineOn: boolean) =>
      build([routineBrain({ memoryOverLimit: { tidyRoutineOn } })]).lines.at(-1)?.tone;
    expect(tone(false)).toBe("warning");
    expect(tone(true)).toBe("neutral");
  });

  it("keeps a server that is older, failing or slow from blanking the others", () => {
    const section = build([
      routineBrain({
        limits: undefined,
        copies: [
          { key: "mac:brain", label: "This Mac", tasks: ready({ tasks: [task({})] }) },
          { key: "old:brain", label: "Old server", tasks: { state: "outdated" } },
          { key: "bad:brain", label: "Bad", tasks: { state: "failed", message: "Timed out." } },
          { key: "slow:brain", label: "Slow", tasks: { state: "loading" } },
        ],
      }),
    ]);
    expect(facts(section.lines).map(([text, detail]) => [text, detail])).toEqual([
      [
        "This Mac: Start my day",
        "Every day at 8:00 AM · Next tomorrow at 8:00 · Last run went well",
      ],
      ["Old server: Update this server to see its routines", null],
      ["Bad: Couldn't read its routines", "Timed out."],
    ]);
    expect(section.loading).toBe(true);
  });

  it("says there are no routines only once that is known", () => {
    const none = routineBrain({
      limits: undefined,
      copies: [{ key: "mac:brain", label: null, tasks: ready({ tasks: [] }) }],
    });
    expect(build([none]).lines.map((line) => line.text)).toEqual(["No routines yet"]);
    expect(build([none], true)).toEqual({ lines: [], loading: true });
    expect(build([])).toEqual({ lines: [], loading: false });
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

describe("notesSection", () => {
  const formatAgo = () => "5 min ago";
  const copy = (overrides: Partial<OverviewNotesCopy>): OverviewNotesCopy => ({
    key: "mac:brain",
    environmentId: mac,
    projectId: brain,
    label: null,
    backup: { ...status, remote },
    index: ready({
      state: "ready" as const,
      noteCount: 1204,
      lastIndexedAt: "2026-11-15T08:00:00.000Z",
    }),
    ...overrides,
  });
  const build = (copies: ReadonlyArray<OverviewNotesCopy>, loading = false) =>
    notesSection({ copies, offline: [], loading, formatAgo });

  it("gives each copy its backup and its search in one line each", () => {
    const section = build([copy({})]);
    expect(facts(section.lines)).toEqual([
      ["Backed up to GitHub ✓", "Your edits were saved 5 min ago.", "ok"],
      ["Notes search is ready", "1204 notes, last updated 5 min ago", "ok"],
    ]);
    expect(section.lines[0]?.link).toEqual({ to: "/settings/backup" });
  });

  it("is orange for a paused or failing backup, never for one nobody chose", () => {
    const tone = (backup: MajordomeBackupStatus) => build([copy({ backup })]).lines[0]?.tone;
    expect(tone(status)).toBe("neutral");
    expect(
      tone({
        ...status,
        paused: { reason: "secret", files: ["a.md"], since: "2026-11-15T08:00:00.000Z" },
      }),
    ).toBe("warning");
    expect(
      facts(build([copy({ backup: { ...status, saveError: "Disk full." } })]).lines)[0],
    ).toEqual(["Saving isn't working", "Disk full.", "warning"]);
  });

  it("offers a rebuild only for a search that failed", () => {
    const index = (value: OverviewNotesCopy["index"]) => build([copy({ index: value })]).lines[1];
    expect(
      index(
        ready({ state: "error", noteCount: 0, lastIndexedAt: null, reason: "The disk is full." }),
      ),
    ).toMatchObject({
      text: "Notes search isn't working",
      detail: "The disk is full.",
      tone: "error",
      rebuild: { environmentId: mac, projectId: brain },
    });
    const building = index(ready({ state: "building", noteCount: 1, lastIndexedAt: null }));
    expect([building?.text, building?.detail, building?.tone, building?.rebuild]).toEqual([
      "Notes search is getting ready",
      "1 note so far. You can already search them.",
      "neutral",
      undefined,
    ]);
    expect(index({ state: "outdated" })?.text).toBe("Update this server to see its notes search");
    // A slow search does not hold the backup line back.
    const slow = build([copy({ index: { state: "loading" } })]);
    expect([slow.lines.length, slow.loading]).toEqual([1, true]);
  });

  it("names the copy where several are listed, and the machines it cannot ask", () => {
    const section = notesSection({
      copies: [copy({ label: "This Mac" })],
      offline: [{ key: "server", label: "Always-on server" }],
      loading: false,
      formatAgo,
    });
    expect(section.lines.map((line) => line.text)).toEqual([
      "This Mac: Backed up to GitHub ✓",
      "This Mac: Notes search is ready",
      "Always-on server: Not connected",
    ]);
  });

  it("says there is no notes folder only once that is known", () => {
    expect(build([]).lines.map((line) => line.text)).toEqual(["No notes folder yet"]);
    expect(build([], true)).toEqual({ lines: [], loading: true });
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

describe("accessSection", () => {
  const documents: MajordomePrivateDocumentsResult = { documents: [], accessLog: [] };
  const machine = (overrides: Partial<OverviewAccessMachine>): OverviewAccessMachine => ({
    key: "mac",
    environmentId: mac,
    label: null,
    connected: true,
    providers: [provider({})],
    secrets: [],
    documents: ready(documents),
    pendingRequests: 0,
    ...overrides,
  });
  const build = (machines: ReadonlyArray<OverviewAccessMachine>) =>
    accessSection({ machines, formatAgo: () => "2 hours ago" });
  const signedOutCodex = provider({
    instanceId: "codex",
    driver: "codex",
    auth: { status: "unauthenticated" },
  });

  it("lists the AIs installed on the machine, its secret sources and its documents", () => {
    const section = build([
      machine({
        providers: [
          provider({}),
          signedOutCodex,
          provider({ instanceId: "cursor", driver: "cursor", installed: false }),
        ],
        secrets: [
          { id: "keychain", label: "My Keychain", kind: "Mac Keychain", uses: 2 },
          { id: "new", label: "Work", kind: "1Password", uses: 0 },
          { id: "odd", label: "Odd", kind: null, uses: 1 },
        ],
      }),
    ]);
    expect(facts(section.lines)).toEqual([
      ["Claude", "Signed in", "ok"],
      // One AI that works is enough.
      ["Codex", "Not signed in", "neutral"],
      ["Secret source: My Keychain", "Mac Keychain · Read by 2 settings", "neutral"],
      ["Secret source: Work", "1Password · Not used yet", "neutral"],
      [
        "Secret source: Odd",
        "This version of Majordome doesn't know this kind of source.",
        "neutral",
      ],
      ["No private documents", null, "neutral"],
    ]);
    expect(section.lines[0]?.link).toEqual({
      to: "/settings/providers",
      search: { environmentId: mac },
    });
    expect(section.loading).toBe(false);
  });

  it("is orange when no AI on the machine can work", () => {
    const tones = (providers: ReadonlyArray<ServerProvider>) =>
      build([machine({ providers })]).lines.map((line) => [line.text, line.tone])[0];
    expect(tones([signedOutCodex])).toEqual(["Codex", "warning"]);
    expect(tones([provider({ installed: false })])).toEqual(["No AI is ready to work", "warning"]);
  });

  it("counts the documents, says what last happened, and what waits for an answer", () => {
    const section = build([
      machine({
        pendingRequests: 2,
        documents: ready({
          documents: [
            {
              id: "0".repeat(32),
              name: "Passport",
              description: "",
              fileName: "passport.pdf",
              mediaType: "application/pdf",
              sizeBytes: 10,
              addedAt: "2026-11-15T08:00:00.000Z",
            },
          ],
          accessLog: [
            {
              at: "2026-11-15T09:00:00.000Z",
              documentId: "0".repeat(32),
              documentName: "Passport",
              outcome: "denied",
            },
          ],
        } as MajordomePrivateDocumentsResult),
      }),
    ]);
    expect(
      section.lines.slice(-2).map((line) => [line.text, line.detail, line.tone, line.count]),
    ).toEqual([
      ["2 requests to open a private document wait for your answer", undefined, "warning", 2],
      [
        "1 private document",
        "Latest, 2 hours ago: “Passport”. Your assistant asked for it and you said no.",
        "ok",
        undefined,
      ],
    ]);
  });

  it("keeps a machine that is away or older on the page, under its name", () => {
    const section = build([
      machine({ label: "This Mac", providers: null }),
      machine({
        key: "old",
        environmentId: server,
        label: "Old server",
        secrets: "outdated",
        documents: { state: "outdated" },
      }),
      machine({ key: "away", label: "Away", connected: false, providers: null, secrets: null }),
    ]);
    expect(section.lines.map((line) => line.text)).toEqual([
      "This Mac: No secret sources set up",
      "This Mac: No private documents",
      "Old server: Claude",
      "Old server: Update this server to see its secret sources",
      "Old server: Update this server to see its private documents",
      "Away: Not connected",
    ]);
    // Only the connected machine whose providers are unknown is still being read.
    expect(section.loading).toBe(true);
    expect(build([machine({ connected: false, providers: null })]).loading).toBe(false);
    expect(build([]).loading).toBe(true);
  });
});

describe("phoneSection", () => {
  const devices = [
    { endpoint: "https://push/this", label: "Mac · Chrome", addedAt: null },
    { endpoint: "https://push/phone", label: "iPhone · Safari", addedAt: null },
  ];
  const phone = {
    anywhere: { state: "off" as const, url: null, reason: null },
    tailscale: "ready" as const,
    secureUrl: "https://mac.ts.net",
    wifiUrls: [],
  };

  it("says how many devices get notifications and whether the secure address is on", () => {
    const section = phoneSection({
      support: "supported",
      thisEndpoint: "https://push/this",
      devices: ready(devices),
      phone: ready(phone),
    });
    expect(facts(section.lines)).toEqual([
      ["Notifications reach 2 devices", "This device is one of them.", "ok"],
      ["Secure address is on", "https://mac.ts.net", "ok"],
    ]);
    expect(section.lines.map((line) => line.link)).toEqual([
      { to: "/settings/phone", hash: "notifications" },
      { to: "/settings/phone" },
    ]);
  });

  it.each([
    ["without Tailscale", "not-installed"],
    ["beside Tailscale", "ready"],
  ] as const)(
    "counts an address from anywhere as reaching this computer, %s",
    (_name, tailscale) => {
      const section = phoneSection({
        support: "supported",
        thisEndpoint: "https://push/this",
        devices: ready(devices),
        phone: ready({
          ...phone,
          tailscale,
          anywhere: { state: "ready", url: "https://k7m2xq9d.majord.link", reason: null },
        }),
      });
      expect(facts(section.lines)[1]).toEqual([
        "Your phone can reach this computer from anywhere",
        "https://k7m2xq9d.majord.link",
        "ok",
      ]);
    },
  );

  it("names the computer the phone is set up on when it is another one", () => {
    const section = phoneSection({
      support: "supported",
      thisEndpoint: "https://push/this",
      devices: ready(devices),
      phone: ready({
        ...phone,
        tailscale: "not-installed",
        anywhere: { state: "ready", url: "https://k7m2xq9d.majord.link", reason: null },
      }),
      elsewhere: "Home server",
    });
    expect(facts(section.lines)).toEqual([
      ["Notifications from Home server reach 2 devices", null, "ok"],
      ["Your phone can reach Home server from anywhere", "https://k7m2xq9d.majord.link", "ok"],
    ]);
  });

  it("is never orange for notifications or an address nobody turned on", () => {
    const section = phoneSection({
      support: "needs-home-screen",
      thisEndpoint: null,
      devices: ready([]),
      phone: ready({ ...phone, tailscale: "not-installed", secureUrl: null }),
    });
    expect(facts(section.lines)).toEqual([
      [
        "No device gets notifications yet",
        "Add Majordome to the Home Screen to get them on this device.",
        "neutral",
      ],
      [
        "No address for your phone yet",
        "Set it up to use Majordome from your phone, away from home.",
        "neutral",
      ],
    ]);
  });

  it("shows what it has while the rest is read, and says when a server can't answer", () => {
    const section = phoneSection({
      support: "supported",
      thisEndpoint: undefined,
      devices: { state: "loading" },
      phone: { state: "outdated" },
    });
    expect(facts(section.lines)).toEqual([
      ["Update this server to see its secure address", null, "neutral"],
    ]);
    expect(section.loading).toBe(true);
  });
});
