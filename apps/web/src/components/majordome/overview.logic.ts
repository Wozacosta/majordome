import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type {
  DesktopBackgroundServiceState,
  MajordomeBackupStatus,
  MajordomePhoneSetup,
  MajordomePushDevice,
  MajordomeRoutinesRunner,
  ScheduledTask,
  ServerProvider,
} from "@t3tools/contracts";

import { backupAttention, backupHeadline } from "./backup.logic";
import type { NotesSearch } from "./notes.logic";
import type { DevicePushSupport } from "./phone.logic";

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

export const OVERVIEW_TONE_BOX_CLASS: Record<OverviewTone, string> = {
  ok: "border-border",
  neutral: "border-border",
  warning: "border-warning/60",
  error: "border-destructive/60",
};

const TONE_RANK: Record<OverviewTone, number> = { neutral: 0, ok: 1, warning: 2, error: 3 };

/** The most serious tone; neutral lines never hide an ok one. */
export function worstTone(tones: ReadonlyArray<OverviewTone>): OverviewTone {
  return tones.reduce<OverviewTone>(
    (worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
    "neutral",
  );
}

export type OverviewPath =
  | "/settings/notifications"
  | "/settings/phone"
  | "/settings/always-on"
  | "/settings/providers"
  | "/settings/scheduled-tasks"
  | "/feed"
  | "/settings/backup"
  | "/notes";

export interface OverviewLink {
  readonly to: OverviewPath;
  readonly search?: NotesSearch;
}

export interface OverviewLine {
  readonly key: string;
  readonly text: string;
  readonly detail?: string;
  readonly tone: OverviewTone;
  readonly link?: OverviewLink;
}

export interface OverviewBox {
  readonly key: string;
  readonly title: string;
  readonly link: OverviewLink;
  readonly tone: OverviewTone;
  readonly lines: ReadonlyArray<OverviewLine>;
}

function box(input: Omit<OverviewBox, "tone">): OverviewBox {
  return { ...input, tone: worstTone(input.lines.map((line) => line.tone)) };
}

const PUSH_SUPPORT_COPY: Record<Exclude<DevicePushSupport, "supported">, string> = {
  insecure: "Can't get notifications on this address",
  "needs-home-screen": "Add Majordome to the Home Screen to get notifications",
  unsupported: "This browser can't get notifications",
};

export function devicesBox(input: {
  readonly support: DevicePushSupport;
  /** This browser's subscription: undefined while it is read, null when off. */
  readonly thisEndpoint: string | null | undefined;
  /** Null while the list loads. */
  readonly devices: ReadonlyArray<MajordomePushDevice> | null;
}): OverviewBox {
  const thisDevice: OverviewLine =
    input.support !== "supported"
      ? {
          key: "this",
          text: "This device",
          detail: PUSH_SUPPORT_COPY[input.support],
          tone: "neutral",
        }
      : input.thisEndpoint === undefined
        ? { key: "this", text: "This device", detail: "Checking notifications…", tone: "neutral" }
        : input.thisEndpoint === null
          ? { key: "this", text: "This device", detail: "Notifications off", tone: "neutral" }
          : { key: "this", text: "This device", detail: "Notifications on", tone: "ok" };
  const others: Array<OverviewLine> =
    input.devices === null
      ? []
      : input.devices
          .filter((device) => device.endpoint !== input.thisEndpoint)
          .map((device) => ({
            key: device.endpoint,
            text: device.label ?? "A device",
            detail: "Gets notifications",
            tone: "ok" as const,
          }));
  const none: Array<OverviewLine> =
    input.devices !== null && input.devices.length === 0
      ? [{ key: "none", text: "No device gets notifications yet", tone: "neutral" }]
      : [];
  return box({
    key: "devices",
    title: "Your devices",
    link: { to: "/settings/notifications" },
    lines: [thisDevice, ...others, ...none],
  });
}

/** A provider is ready when it is installed, signed in (or needs no sign-in) and working. */
function providerReady(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.auth.status !== "unauthenticated"
  );
}

function providerDetail(provider: ServerProvider): string {
  if (providerReady(provider)) return "Ready";
  if (provider.auth.status === "unauthenticated") return "Signed out";
  if (provider.status === "error") return "Not working";
  return "Needs attention";
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

export function majordomeBox(input: {
  readonly connected: boolean;
  /** The first line; plain "Running" unless the app knows about its background service. */
  readonly running?: OverviewLine;
  /** Null until the server's providers are known. */
  readonly providers: ReadonlyArray<ServerProvider> | null;
  readonly phone: MajordomePhoneSetup | null;
}): OverviewBox {
  if (!input.connected) {
    return box({
      key: "majordome",
      title: "Majordome on this computer",
      link: { to: "/settings/providers" },
      lines: [
        {
          key: "running",
          text: "Not reachable",
          detail: "Majordome on your computer isn't answering. Is the computer on?",
          tone: "error",
        },
      ],
    });
  }
  const installed = (input.providers ?? []).filter(
    (provider) => provider.enabled && provider.installed,
  );
  const providerLines: Array<OverviewLine> = installed.map((provider) => ({
    key: `provider:${provider.instanceId}`,
    text: resolveProviderInstanceDisplayName(provider),
    detail: providerDetail(provider),
    tone: providerReady(provider) ? "ok" : "neutral",
    link: { to: "/settings/providers" },
  }));
  const noAi: Array<OverviewLine> =
    input.providers !== null && !installed.some(providerReady)
      ? [
          {
            key: "no-ai",
            text: "No AI is ready to work",
            detail: "Sign in to Claude, Codex or another AI so routines can run.",
            tone: "warning",
            link: { to: "/settings/providers" },
          },
        ]
      : [];
  const phone: Array<OverviewLine> =
    input.phone === null
      ? []
      : [
          input.phone.tailscale === "ready"
            ? {
                key: "phone",
                text: "Phone address",
                detail: "On, secure",
                tone: "ok",
                link: { to: "/settings/phone" },
              }
            : {
                key: "phone",
                text: "Phone address",
                detail: "Off",
                tone: "neutral",
                link: { to: "/settings/phone" },
              },
        ];
  return box({
    key: "majordome",
    title: "Majordome on this computer",
    link: { to: "/settings/providers" },
    lines: [input.running ?? RUNNING_LINE, ...providerLines, ...noAi, ...phone],
  });
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

export function brainBox(input: {
  readonly key: string;
  readonly title: string;
  readonly link: OverviewLink;
  /** Null while the vault's history loads. */
  readonly runner: MajordomeRoutinesRunner | null;
  /** The vault's routines; null while they load. */
  readonly routines: ReadonlyArray<ScheduledTask> | null;
  readonly waiting: number;
  readonly failed: number;
  readonly formatNextRun: (iso: string) => string;
}): OverviewBox {
  const runner: Array<OverviewLine> =
    input.runner === null ? [] : [{ key: "runner", ...RUNNER_LINE[input.runner] }];
  const routines: Array<OverviewLine> = (input.routines ?? []).map((task) => ({
    key: `routine:${task.id}`,
    text: task.title,
    detail: !task.enabled
      ? "Off"
      : task.lastRunStatus === "failed"
        ? "Last run couldn't finish"
        : task.lastRunStatus === "running"
          ? "Running now"
          : task.nextRunAt !== null
            ? `Next ${input.formatNextRun(task.nextRunAt)}`
            : task.schedule.type === "webhook"
              ? "When something arrives"
              : "Not scheduled",
    tone: task.enabled && task.lastRunStatus === "failed" ? "error" : "neutral",
    link: { to: "/settings/scheduled-tasks" },
  }));
  const attention: Array<OverviewLine> = [];
  if (input.waiting > 0) {
    attention.push({
      key: "waiting",
      text:
        input.waiting === 1
          ? "A run is waiting for you"
          : `${input.waiting} runs are waiting for you`,
      tone: "warning",
      link: { to: "/feed" },
    });
  }
  if (input.failed > 0) {
    attention.push({
      key: "failed",
      text: input.failed === 1 ? "A run couldn't finish" : `${input.failed} runs couldn't finish`,
      tone: "error",
      link: { to: "/feed" },
    });
  }
  if (attention.length === 0) {
    attention.push({ key: "nothing", text: "Nothing waiting for you", tone: "ok" });
  }
  return box({
    key: `brain:${input.key}`,
    title: input.title,
    link: input.link,
    lines: [...attention, ...runner, ...routines],
  });
}

/** Lines for a copy the person chose; a copy never set up stays neutral, as in the sidebar. */
function copyLine(
  key: string,
  name: string,
  copy: { readonly lastBackupAt: string | null; readonly lastError: string | null } | null,
  formatAgo: (iso: string) => string,
): OverviewLine {
  if (copy === null) {
    return {
      key,
      text: name,
      detail: "Not set up",
      tone: "neutral",
      link: { to: "/settings/backup" },
    };
  }
  if (copy.lastError !== null) {
    return {
      key,
      text: name,
      detail: copy.lastError,
      tone: "warning",
      link: { to: "/settings/backup" },
    };
  }
  return {
    key,
    text: name,
    detail:
      copy.lastBackupAt === null
        ? "First copy tonight"
        : `Last copy ${formatAgo(copy.lastBackupAt)}`,
    tone: copy.lastBackupAt === null ? "neutral" : "ok",
    link: { to: "/settings/backup" },
  };
}

function remoteLine(
  status: MajordomeBackupStatus,
  formatAgo: (iso: string) => string,
): OverviewLine {
  const { remote } = status;
  const name = remote?.isGitHub === false ? (remote.host ?? "Another folder") : "GitHub";
  if (remote === null) {
    return {
      key: "remote",
      text: "GitHub",
      detail: "Not connected",
      tone: "neutral",
      link: { to: "/settings/backup" },
    };
  }
  if (!remote.syncing) {
    return {
      key: "remote",
      text: name,
      detail: "Syncing off",
      tone: "neutral",
      link: { to: "/settings/backup" },
    };
  }
  if (remote.lastError !== null) {
    return {
      key: "remote",
      text: name,
      detail: remote.lastError,
      tone: "warning",
      link: { to: "/settings/backup" },
    };
  }
  return {
    key: "remote",
    text: name,
    detail: remote.backedUp
      ? remote.lastSyncedAt === null
        ? "Backed up"
        : `Backed up ${formatAgo(remote.lastSyncedAt)}`
      : "Sending your latest changes",
    tone: remote.backedUp ? "ok" : "neutral",
    link: { to: "/settings/backup" },
  };
}

export function backupBox(input: {
  readonly key: string;
  readonly status: MajordomeBackupStatus;
  readonly formatAgo: (iso: string) => string;
}): OverviewBox {
  const { status, formatAgo } = input;
  const headline = backupHeadline(status);
  const needsAttention = backupAttention(status) !== null;
  const lines: Array<OverviewLine> = [
    {
      key: "headline",
      text: headline.title,
      tone: needsAttention ? "warning" : headline.tone === "ok" ? "ok" : "neutral",
      link: { to: "/settings/backup" },
    },
    status.saveError !== null
      ? { key: "edits", text: "Your edits", detail: status.saveError, tone: "warning" }
      : {
          key: "edits",
          text: "Your edits",
          detail:
            status.lastSavedAt === null
              ? "Saved every 5 minutes"
              : `Last saved ${formatAgo(status.lastSavedAt)}`,
          tone: status.lastSavedAt === null ? "neutral" : "ok",
        },
    remoteLine(status, formatAgo),
    copyLine("folder", "Folder copy", status.folder, formatAgo),
    copyLine("drive", "Google Drive copy", status.drive, formatAgo),
  ];
  return box({
    key: `backup:${input.key}`,
    title: "Backups",
    link: { to: "/settings/backup" },
    lines,
  });
}
