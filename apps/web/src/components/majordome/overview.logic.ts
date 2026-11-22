import type {
  DesktopBackgroundServiceState,
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeNotesIndexStatus,
  MajordomePhoneSetup,
  MajordomePrivateDocumentsResult,
  MajordomePushDevice,
  MajordomeRoutineLimits,
  MajordomeRoutinesRunner,
  MajordomeRoutinesStatus,
  ProjectId,
  ScheduledTask,
  ServerProvider,
} from "@t3tools/contracts";

import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { backupAttention, backupHeadline } from "./backup.logic";
import { machineInSentence } from "./brains.logic";
import { aiRows } from "./connections.logic";
import { type FeedRunStatus, memoryOverLimitLine, routinesBlockedLine } from "./feed.logic";
import {
  type DevicePushSupport,
  NOTIFICATIONS_ANCHOR,
  phoneAddress,
  phoneComputerWords,
} from "./phone.logic";
import { describeAccess } from "./privateDocuments.logic";
import { ROUTINE_LAST_RUN, routineKind } from "./routines.logic";

/**
 * How a part of the setup is doing. Warning (orange) and error (red) are the sidebar's dots:
 * orange when something waits for the person or a chosen backup is stuck, red when a run failed.
 */
export type OverviewTone = "ok" | "neutral" | "warning" | "error";

export const OVERVIEW_TONE_DOT_CLASS: Record<OverviewTone, string> = {
  ok: "bg-success",
  neutral: "bg-muted-foreground/40",
  warning: "bg-warning",
  error: "bg-destructive",
};

const TONE_RANK: Record<OverviewTone, number> = { neutral: 0, ok: 1, warning: 2, error: 3 };

/** The most serious tone; neutral lines never hide an ok one. */
export function worstTone(tones: ReadonlyArray<OverviewTone>): OverviewTone {
  return tones.reduce<OverviewTone>(
    (worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
    "neutral",
  );
}

/** Where a line is fixed. Providers opens on the machine the line is about. */
export type OverviewLink =
  | {
      readonly to: "/settings/providers";
      readonly search?: { readonly environmentId: EnvironmentId };
    }
  | {
      readonly to:
        | "/settings/phone"
        | "/settings/always-on"
        | "/settings/connections"
        | "/routines"
        | "/settings/backup"
        | "/settings/secrets"
        | "/settings/private-documents"
        | "/feed";
      readonly hash?: string;
    };

export interface OverviewLine {
  readonly key: string;
  readonly text: string;
  readonly detail?: string;
  readonly tone: OverviewTone;
  readonly link?: OverviewLink;
  /** How many things the line stands for in the verdict; one unless it sums several runs. */
  readonly count?: number;
  /** The page's one control: a notes search that failed can be rebuilt from its line. */
  readonly rebuild?: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
}

export interface OverviewSection {
  readonly lines: ReadonlyArray<OverviewLine>;
  /** Something in it is still being read; what is known already shows. */
  readonly loading: boolean;
}

/** What one request to a server gave: its answer, or why there is none. */
export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  /** The server is from before this feature. */
  | { readonly state: "outdated" }
  | { readonly state: "failed"; readonly message: string };

const NOT_CONNECTED = "Not connected";

/** "This Mac: Connected" where several machines or brains are listed, else the words alone. */
function say(label: string | null, text: string): string {
  return label === null ? text : `${label}: ${text}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function section(lines: ReadonlyArray<OverviewLine>, loading: boolean): OverviewSection {
  return { lines, loading };
}

/** A line that only says a server could not answer; null when it answered. */
function unansweredLine<T>(
  loaded: Loaded<T>,
  input: { readonly key: string; readonly label: string | null; readonly what: string },
): OverviewLine | null {
  if (loaded.state === "outdated") {
    return {
      key: input.key,
      text: say(input.label, `Update this server to see ${input.what}`),
      tone: "neutral",
      link: { to: "/settings/connections" },
    };
  }
  if (loaded.state === "failed") {
    return {
      key: input.key,
      text: say(input.label, `Couldn't read ${input.what}`),
      detail: loaded.message,
      tone: "neutral",
    };
  }
  return null;
}

/**
 * The top of the page: how many things need the owner, and which. Red before orange, each in the
 * order the page lists them, runs first.
 */
export function overviewVerdict(
  needsYou: ReadonlyArray<OverviewLine>,
  sections: ReadonlyArray<OverviewSection>,
): {
  readonly text: string;
  readonly tone: OverviewTone;
  readonly items: ReadonlyArray<OverviewLine>;
} {
  const lines = [...needsYou, ...sections.flatMap((part) => part.lines)];
  const items = [
    ...lines.filter((line) => line.tone === "error"),
    ...lines.filter((line) => line.tone === "warning"),
  ];
  const count = items.reduce((sum, line) => sum + (line.count ?? 1), 0);
  if (count > 0) {
    return {
      text: count === 1 ? "1 thing needs you." : `${count} things need you.`,
      tone: worstTone(items.map((line) => line.tone)),
      items,
    };
  }
  return sections.some((part) => part.loading)
    ? { text: "Checking…", tone: "neutral", items }
    : { text: "Everything is working.", tone: "ok", items };
}

/**
 * The runs that need the owner, as the Feed's "Needs you" counts them. A run that waits on a
 * private document request is left to that request's own line.
 */
export function needsYouLines(
  runs: ReadonlyArray<{
    readonly status: FeedRunStatus;
    readonly privateDocumentRequest?: boolean;
  }>,
): ReadonlyArray<OverviewLine> {
  const count = (status: FeedRunStatus) =>
    runs.filter((run) => run.status === status && run.privateDocumentRequest !== true).length;
  const waiting = count("waiting");
  const failed = count("failed");
  const stopped = count("stopped");
  const lines: Array<OverviewLine> = [];
  if (failed > 0) {
    lines.push({
      key: "runs:failed",
      text: failed === 1 ? "A run couldn't finish" : `${failed} runs couldn't finish`,
      tone: "error",
      link: { to: "/feed" },
      count: failed,
    });
  }
  if (stopped > 0) {
    lines.push({
      key: "runs:stopped",
      text:
        stopped === 1
          ? "A run was stopped: it ran too long"
          : `${stopped} runs were stopped: they ran too long`,
      tone: "error",
      link: { to: "/feed" },
      count: stopped,
    });
  }
  if (waiting > 0) {
    lines.push({
      key: "runs:waiting",
      text: waiting === 1 ? "A run is waiting for you" : `${waiting} runs are waiting for you`,
      tone: "warning",
      link: { to: "/feed" },
      count: waiting,
    });
  }
  return lines;
}

const RUNNING_LINE: OverviewLine = { key: "running", text: "Running", tone: "ok" };

/**
 * Whether Majordome keeps running once its window closes. Only the Mac app can tell; elsewhere
 * (null, or unsupported) it is just running.
 */
export function backgroundRunningLine(
  background: DesktopBackgroundServiceState | null,
  formatSince: (iso: string) => string,
): OverviewLine {
  if (background === null || !background.supported) return RUNNING_LINE;
  if (!background.enabled) {
    return {
      key: "running",
      text: "Running while the window is open",
      detail: "Routines stop when you close it.",
      tone: "neutral",
    };
  }
  if (!background.running) {
    return {
      key: "running",
      text: "Stopped",
      detail: "It starts again when you open Majordome or log in.",
      tone: "warning",
    };
  }
  return {
    key: "running",
    text:
      background.runningSince === null
        ? "Running in the background"
        : `Running in the background since ${formatSince(background.runningSince)}`,
    tone: "ok",
  };
}

export interface OverviewMachine {
  readonly environmentId: EnvironmentId;
  /** The machine's name; null where it is the only one. */
  readonly label: string | null;
  /** The window's own server. */
  readonly primary: boolean;
  readonly connection: "connected" | "connecting" | "disconnected";
  /** The Majordome version it runs, when it has said. */
  readonly version: string | null;
  /** Its version is older than this app's. */
  readonly behind: boolean;
}

function machineLine(
  machine: OverviewMachine,
  background: DesktopBackgroundServiceState | null,
  formatSince: (iso: string) => string,
): OverviewLine {
  const key = `machine:${machine.environmentId}`;
  if (machine.connection === "connecting") {
    return { key, text: say(machine.label, "Connecting…"), tone: "neutral" };
  }
  if (machine.connection === "disconnected") {
    return machine.primary
      ? {
          key,
          text: say(machine.label, "Not reachable"),
          detail: "Majordome on your computer isn't answering. Is the computer on?",
          tone: "error",
          link: { to: "/settings/connections" },
        }
      : {
          key,
          text: say(machine.label, NOT_CONNECTED),
          detail: "Majordome can't reach this machine right now. Is it on?",
          tone: "warning",
          link: { to: "/settings/connections" },
        };
  }
  const running = machine.primary
    ? backgroundRunningLine(background, formatSince)
    : { ...RUNNING_LINE, text: "Connected" };
  const version = machine.version === null ? null : `Version ${machine.version}`;
  if (machine.behind) {
    return {
      key,
      text: say(machine.label, running.text),
      detail: `${version ?? "Its version"} is older than this app. Update it so everything works together.`,
      tone: worstTone([running.tone, "warning"]),
      link: { to: "/settings/connections" },
    };
  }
  const detail = [running.detail, version].filter((part) => part != null).join(" ");
  return {
    key,
    text: say(machine.label, running.text),
    ...(detail === "" ? {} : { detail }),
    tone: running.tone,
  };
}

const RUNNER_LINE: Record<MajordomeRoutinesRunner, Omit<OverviewLine, "key">> = {
  "this-server": {
    text: "Routines run on this computer",
    detail: "Only while it's awake. Move them to an always-on server",
    tone: "ok",
    link: { to: "/settings/always-on" },
  },
  "another-server": {
    text: "Routines run on another computer",
    tone: "neutral",
    link: { to: "/feed" },
  },
  none: {
    text: "Routines don't run anywhere yet",
    detail: "Choose a computer to run them on the Feed.",
    tone: "warning",
    link: { to: "/feed" },
  },
};

export interface OverviewRunner {
  readonly key: string;
  /** The brain's title; null where there is one brain. */
  readonly label: string | null;
  /** Null while the brain's history loads. */
  readonly runner: MajordomeRoutinesRunner | null;
  /** The name of the server that runs the routines, when the brain is on several. */
  readonly runsOn: string | null;
}

/** "Where it runs": each machine, then which one runs each brain's routines. */
export function whereItRunsSection(input: {
  /** Empty until the connections are known. */
  readonly machines: ReadonlyArray<OverviewMachine>;
  readonly background: DesktopBackgroundServiceState | null;
  readonly formatSince: (iso: string) => string;
  readonly runners: ReadonlyArray<OverviewRunner>;
}): OverviewSection {
  const runners = input.runners.flatMap((brain): ReadonlyArray<OverviewLine> => {
    const key = `runner:${brain.key}`;
    if (brain.runsOn !== null) {
      return [
        {
          key,
          text: say(brain.label, `Routines run on ${machineInSentence(brain.runsOn)}`),
          tone: "ok",
          link: { to: "/feed" },
        },
      ];
    }
    if (brain.runner === null) return [];
    const line = RUNNER_LINE[brain.runner];
    return [{ ...line, key, text: say(brain.label, line.text) }];
  });
  return section(
    [
      ...input.machines.map((machine) => machineLine(machine, input.background, input.formatSince)),
      ...runners,
    ],
    input.machines.length === 0 ||
      input.runners.some((brain) => brain.runsOn === null && brain.runner === null),
  );
}

/** One server's routines for one brain. */
export interface OverviewRoutineCopy {
  readonly key: string;
  /** The brain, the machine or both, where several are listed. */
  readonly label: string | null;
  /**
   * False for a computer that keeps a copy of the routines but does not run them: they only run
   * where the notes folder's routines are set to run, so its copies are neither listed nor counted
   * as having missed anything. Its reminders still go off there.
   */
  readonly runsRoutines?: boolean;
  readonly tasks: Loaded<{
    readonly tasks: ReadonlyArray<ScheduledTask>;
    /** The server's zone for fixed-time schedules. */
    readonly timeZone?: string | undefined;
  }>;
}

export interface OverviewRoutineBrain {
  readonly key: string;
  /** The brain's title; null where there is one brain. */
  readonly label: string | null;
  /** The server that runs the brain's routines. */
  readonly runner: { readonly environmentId: EnvironmentId; readonly machine: string };
  readonly routinesStatus: MajordomeRoutinesStatus | undefined;
  /** Today's runs are used up; null when they are not. */
  readonly pausedRunsPerDay: number | null;
  readonly limits: MajordomeRoutineLimits | undefined;
  readonly memoryOverLimit: { readonly tidyRoutineOn: boolean } | undefined;
  readonly copies: ReadonlyArray<OverviewRoutineCopy>;
}

function routineLine(
  task: ScheduledTask,
  copy: OverviewRoutineCopy,
  timeZone: string | undefined,
  formatNextRun: (iso: string) => string,
): OverviewLine {
  const lastRun = task.lastRunStatus === "never" ? null : ROUTINE_LAST_RUN[task.lastRunStatus];
  const parts = !task.enabled
    ? ["Off"]
    : [
        task.schedule.type === "webhook"
          ? "When something arrives"
          : scheduleLabel(task.schedule, timeZone, task.nextRunAt),
        task.schedule.type === "webhook"
          ? null
          : task.nextRunAt === null
            ? "Not scheduled"
            : `Next ${formatNextRun(task.nextRunAt)}`,
        lastRun?.text ?? null,
      ];
  return {
    key: `routine:${copy.key}:${task.id}`,
    text: say(copy.label, task.title),
    detail: parts.filter((part) => part !== null).join(" · "),
    tone: !task.enabled || lastRun === null ? "neutral" : lastRun.tone,
    link: { to: "/routines" },
  };
}

/** "Routines": whether they can run, each one's next run and last result, and their limits. */
export function routinesSection(input: {
  readonly brains: ReadonlyArray<OverviewRoutineBrain>;
  /** A vault or its history is still being read. */
  readonly loading: boolean;
  readonly formatNextRun: (iso: string) => string;
}): OverviewSection {
  let loading = input.loading;
  const lines: Array<OverviewLine> = [];
  for (const brain of input.brains) {
    const tasksLink = { to: "/routines" } as const;
    const blocked = routinesBlockedLine(brain.routinesStatus, brain.runner.machine);
    if (blocked !== null) {
      lines.push({
        key: `blocked:${brain.key}`,
        text: say(brain.label, blocked.text),
        tone: blocked.tone,
        link: { to: "/settings/providers", search: { environmentId: brain.runner.environmentId } },
      });
    }
    if (brain.pausedRunsPerDay !== null) {
      lines.push({
        key: `paused:${brain.key}`,
        text: say(
          brain.label,
          `Routines are paused until tomorrow: they used today's ${brain.pausedRunsPerDay} runs`,
        ),
        tone: "warning",
        link: tasksLink,
      });
    }
    for (const copy of brain.copies) {
      if (copy.tasks.state === "loading") {
        loading = true;
      } else if (copy.tasks.state === "ready") {
        const { tasks, timeZone } = copy.tasks.value;
        lines.push(
          ...tasks
            // A reminder that already went off is not something that runs any more.
            .filter((task) => routineKind(task) !== "done")
            .filter((task) => copy.runsRoutines !== false || task.schedule.type === "once")
            .map((task) => routineLine(task, copy, timeZone, input.formatNextRun)),
        );
      } else {
        const line = unansweredLine(copy.tasks, {
          key: `routines:${copy.key}`,
          label: copy.label,
          what: "its routines",
        });
        if (line !== null) lines.push(line);
      }
    }
    if (brain.limits !== undefined && brain.pausedRunsPerDay === null) {
      const { runsPerDay, runMinutes } = brain.limits;
      lines.push({
        key: `limits:${brain.key}`,
        text: say(
          brain.label,
          `Up to ${plural(runsPerDay, "run", "runs")} a day, ${plural(runMinutes, "minute", "minutes")} each`,
        ),
        tone: "neutral",
        link: tasksLink,
      });
    }
    const memory = memoryOverLimitLine(brain.memoryOverLimit);
    if (memory !== null) {
      lines.push({
        key: `memory:${brain.key}`,
        text: say(brain.label, memory),
        // With "Tidy my memory" on, tonight's run fixes it without the owner.
        tone: brain.memoryOverLimit?.tidyRoutineOn ? "neutral" : "warning",
        link: tasksLink,
      });
    }
  }
  if (lines.length === 0 && !loading && input.brains.length > 0) {
    return section(
      [
        {
          key: "routines:none",
          text: "No routines yet",
          tone: "neutral",
          link: { to: "/routines" },
        },
      ],
      false,
    );
  }
  return section(lines, loading);
}

/** One server's copy of a brain's notes. */
export interface OverviewNotesCopy {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The brain, the machine or both, where several are listed. */
  readonly label: string | null;
  readonly backup: MajordomeBackupStatus;
  /** A status of null is a project that is not a vault. */
  readonly index: Loaded<MajordomeNotesIndexStatus | null>;
}

function backupLine(copy: OverviewNotesCopy, formatAgo: (iso: string) => string): OverviewLine {
  const { backup } = copy;
  const key = `backup:${copy.key}`;
  const link = { to: "/settings/backup" } as const;
  if (backup.paused === null && backup.saveError !== null) {
    return {
      key,
      text: say(copy.label, "Saving isn't working"),
      detail: backup.saveError,
      tone: "warning",
      link,
    };
  }
  const headline = backupHeadline(backup);
  const saved =
    backup.lastSavedAt === null ? null : `Your edits were saved ${formatAgo(backup.lastSavedAt)}.`;
  const detail = [headline.detail, saved].filter((part) => part !== null).join(" ");
  return {
    key,
    text: say(copy.label, headline.title),
    ...(detail === "" ? {} : { detail }),
    // "Not backed up yet" alone is a choice still to make, as in the sidebar.
    tone: backupAttention(backup) !== null ? "warning" : headline.tone === "ok" ? "ok" : "neutral",
    link,
  };
}

function indexLine(
  copy: OverviewNotesCopy,
  formatAgo: (iso: string) => string,
): OverviewLine | null {
  const key = `index:${copy.key}`;
  if (copy.index.state !== "ready") {
    return unansweredLine(copy.index, { key, label: copy.label, what: "its notes search" });
  }
  const status = copy.index.value;
  if (status === null) return null;
  const notes = plural(status.noteCount, "note", "notes");
  if (status.state === "error") {
    return {
      key,
      text: say(copy.label, "Notes search isn't working"),
      detail: status.reason ?? "Rebuild it to search your notes again.",
      tone: "error",
      rebuild: { environmentId: copy.environmentId, projectId: copy.projectId },
    };
  }
  if (status.state === "building") {
    return {
      key,
      text: say(copy.label, "Notes search is getting ready"),
      detail: `${notes} so far. You can already search them.`,
      tone: "neutral",
    };
  }
  return {
    key,
    text: say(copy.label, "Notes search is ready"),
    detail:
      status.lastIndexedAt === null
        ? notes
        : `${notes}, last updated ${formatAgo(status.lastIndexedAt)}`,
    tone: "ok",
  };
}

/** A line for each machine that cannot be asked right now. */
function notConnectedLines(
  part: string,
  machines: ReadonlyArray<{ readonly key: string; readonly label: string | null }>,
): ReadonlyArray<OverviewLine> {
  return machines.map((machine) => ({
    key: `${part}:offline:${machine.key}`,
    text: say(machine.label, NOT_CONNECTED),
    tone: "neutral",
  }));
}

/** "Notes": each copy's backup, then its search. */
export function notesSection(input: {
  readonly copies: ReadonlyArray<OverviewNotesCopy>;
  /** Machines that are not connected, whose notes cannot be read. */
  readonly offline: ReadonlyArray<{ readonly key: string; readonly label: string | null }>;
  readonly loading: boolean;
  readonly formatAgo: (iso: string) => string;
}): OverviewSection {
  const lines = [
    ...input.copies.flatMap((copy) => {
      const index = indexLine(copy, input.formatAgo);
      return [backupLine(copy, input.formatAgo), ...(index === null ? [] : [index])];
    }),
    ...notConnectedLines("notes", input.offline),
  ];
  const loading = input.loading || input.copies.some((copy) => copy.index.state === "loading");
  if (lines.length === 0 && !loading) {
    return section(
      [
        {
          key: "notes:none",
          text: "No notes folder yet",
          detail: "Open your notes folder in Majordome to see it here.",
          tone: "neutral",
        },
      ],
      false,
    );
  }
  return section(lines, loading);
}

export interface OverviewSecretSource {
  readonly id: string;
  readonly label: string;
  /** What kind of place it is, such as "Mac Keychain"; null for a kind this app does not know. */
  readonly kind: string | null;
  /** How many key and token fields read from it. */
  readonly uses: number;
}

export interface OverviewAccessMachine {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  /** The machine's name; null where it is the only one. */
  readonly label: string | null;
  readonly connected: boolean;
  /** Null until the server's providers are known. */
  readonly providers: ReadonlyArray<ServerProvider> | null;
  /** Null until the server's settings are known; `outdated` from a server without secret sources. */
  readonly secrets: ReadonlyArray<OverviewSecretSource> | "outdated" | null;
  readonly documents: Loaded<MajordomePrivateDocumentsResult>;
  /** Private document requests that wait for the owner's answer. */
  readonly pendingRequests: number;
}

function providerLines(machine: OverviewAccessMachine): ReadonlyArray<OverviewLine> {
  if (machine.providers === null) return [];
  const link = {
    to: "/settings/providers",
    search: { environmentId: machine.environmentId },
  } as const;
  const rows = aiRows(machine.providers.filter((provider) => provider.installed));
  const usable = rows.some((row) => row.state.tone === "ok");
  return [
    ...rows.map((row) => ({
      key: `provider:${machine.key}:${row.key}`,
      text: say(machine.label, row.name),
      detail: [row.state.label, row.state.detail].filter((part) => part !== undefined).join(". "),
      // One AI that works is enough: a second one left signed out is not the owner's problem.
      tone: row.state.tone === "warning" && usable ? ("neutral" as const) : row.state.tone,
      link,
    })),
    ...(rows.length > 0
      ? []
      : [
          {
            key: `provider:${machine.key}:none`,
            text: say(machine.label, "No AI is ready to work"),
            detail: "Sign in to Claude, Codex or another AI so conversations and routines can run.",
            tone: "warning" as const,
            link,
          },
        ]),
  ];
}

function secretLines(machine: OverviewAccessMachine): ReadonlyArray<OverviewLine> {
  if (machine.secrets === null) return [];
  const link = { to: "/settings/secrets" } as const;
  if (machine.secrets === "outdated") {
    return [
      {
        key: `secrets:${machine.key}`,
        text: say(machine.label, "Update this server to see its secret sources"),
        tone: "neutral",
        link: { to: "/settings/connections" },
      },
    ];
  }
  if (machine.secrets.length === 0) {
    return [
      {
        key: `secrets:${machine.key}`,
        text: say(machine.label, "No secret sources set up"),
        tone: "neutral",
        link,
      },
    ];
  }
  return machine.secrets.map((source) => ({
    key: `secrets:${machine.key}:${source.id}`,
    text: say(machine.label, `Secret source: ${source.label}`),
    detail:
      source.kind === null
        ? "This version of Majordome doesn't know this kind of source."
        : `${source.kind} · ${source.uses === 0 ? "Not used yet" : `Read by ${plural(source.uses, "setting", "settings")}`}`,
    tone: "neutral",
    link,
  }));
}

function documentLines(
  machine: OverviewAccessMachine,
  formatAgo: (iso: string) => string,
): ReadonlyArray<OverviewLine> {
  const key = `documents:${machine.key}`;
  const link = { to: "/settings/private-documents" } as const;
  const pending: ReadonlyArray<OverviewLine> =
    machine.pendingRequests === 0
      ? []
      : [
          {
            key: `${key}:pending`,
            text: say(
              machine.label,
              machine.pendingRequests === 1
                ? "A request to open a private document waits for your answer"
                : `${machine.pendingRequests} requests to open a private document wait for your answer`,
            ),
            tone: "warning",
            link: { to: "/feed" },
            count: machine.pendingRequests,
          },
        ];
  if (machine.documents.state !== "ready") {
    const line = unansweredLine(machine.documents, {
      key,
      label: machine.label,
      what: "its private documents",
    });
    return [...pending, ...(line === null ? [] : [line])];
  }
  const { documents, accessLog } = machine.documents.value;
  const [latest] = accessLog;
  if (documents.length === 0 && latest === undefined) {
    return [
      ...pending,
      { key, text: say(machine.label, "No private documents"), tone: "neutral", link },
    ];
  }
  return [
    ...pending,
    {
      key,
      text: say(machine.label, plural(documents.length, "private document", "private documents")),
      ...(latest === undefined
        ? {}
        : {
            detail: `Latest, ${formatAgo(latest.at)}: “${latest.documentName}”. ${describeAccess(latest).what}`,
          }),
      tone: documents.length === 0 ? "neutral" : "ok",
      link,
    },
  ];
}

/** "AI and access": each machine's AI sign-ins, secret sources and private documents. */
export function accessSection(input: {
  /** Empty until the connections are known. */
  readonly machines: ReadonlyArray<OverviewAccessMachine>;
  readonly formatAgo: (iso: string) => string;
}): OverviewSection {
  const lines = input.machines.flatMap((machine) =>
    machine.connected
      ? [
          ...providerLines(machine),
          ...secretLines(machine),
          ...documentLines(machine, input.formatAgo),
        ]
      : notConnectedLines("access", [machine]),
  );
  return section(
    lines,
    input.machines.length === 0 ||
      input.machines.some(
        (machine) =>
          machine.connected &&
          (machine.providers === null ||
            machine.secrets === null ||
            machine.documents.state === "loading"),
      ),
  );
}

const PUSH_SUPPORT_COPY: Record<Exclude<DevicePushSupport, "supported">, string> = {
  insecure: "This device can't get them on this address.",
  "needs-home-screen": "Add Majordome to the Home Screen to get them on this device.",
  unsupported: "This browser can't get them.",
};

/** "Phone": which devices get notifications, and whether a phone can reach this computer. */
export function phoneSection(input: {
  readonly support: DevicePushSupport;
  /** This browser's subscription: undefined while it is read, null when off. */
  readonly thisEndpoint: string | null | undefined;
  readonly devices: Loaded<ReadonlyArray<MajordomePushDevice>>;
  readonly phone: Loaded<MajordomePhoneSetup>;
  /** The computer both were read from, by name, when it is another one than this. */
  readonly elsewhere?: string | null;
}): OverviewSection {
  const lines: Array<OverviewLine> = [];
  const elsewhere = input.elsewhere ?? null;
  const computer = phoneComputerWords(elsewhere).inSentence;
  if (input.devices.state === "ready") {
    const devices = input.devices.value;
    // This device subscribes on this computer, so another computer's list says nothing about it.
    const thisDevice =
      elsewhere !== null
        ? null
        : input.support !== "supported"
          ? PUSH_SUPPORT_COPY[input.support]
          : input.thisEndpoint === undefined
            ? null
            : devices.some((device) => device.endpoint === input.thisEndpoint)
              ? "This device is one of them."
              : "This device isn't one of them.";
    lines.push({
      key: "phone:notifications",
      text:
        devices.length === 0
          ? "No device gets notifications yet"
          : `Notifications${elsewhere === null ? "" : ` from ${computer}`} reach ${plural(devices.length, "device", "devices")}`,
      ...(thisDevice === null ? {} : { detail: thisDevice }),
      // Never orange for notifications nobody turned on.
      tone: devices.length === 0 ? "neutral" : "ok",
      link: { to: "/settings/phone", hash: NOTIFICATIONS_ANCHOR },
    });
  } else {
    const line = unansweredLine(input.devices, {
      key: "phone:notifications",
      label: elsewhere,
      what: "its notifications",
    });
    if (line !== null) lines.push(line);
  }
  if (input.phone.state === "ready") {
    const address = phoneAddress(input.phone.value);
    lines.push(
      address === null
        ? {
            key: "phone:address",
            text: "No address for your phone yet",
            detail: "Set it up to use Majordome from your phone, away from home.",
            tone: "neutral",
            link: { to: "/settings/phone" },
          }
        : {
            key: "phone:address",
            text:
              address.way === "anywhere"
                ? `Your phone can reach ${computer} from anywhere`
                : "Secure address is on",
            ...(address.url === null ? {} : { detail: address.url }),
            tone: "ok",
            link: { to: "/settings/phone" },
          },
    );
  } else {
    const line = unansweredLine(input.phone, {
      key: "phone:address",
      label: elsewhere,
      what: "its secure address",
    });
    if (line !== null) lines.push(line);
  }
  return section(lines, input.devices.state === "loading" || input.phone.state === "loading");
}
