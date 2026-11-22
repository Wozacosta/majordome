import type {
  EnvironmentId,
  MajordomeBackupStatus,
  MajordomeRoutinesRunner,
  ProjectId,
  ServerProvider,
} from "@t3tools/contracts";

import { backupAttention } from "./backup.logic";
import type { FeedRunStatus } from "./feed.logic";
import {
  accessSection,
  notesSection,
  needsYouLines,
  type OverviewLink,
  type OverviewMachine,
  type OverviewRoutineBrain,
  type OverviewRunner,
  overviewVerdict,
  routinesSection,
  whereItRunsSection,
} from "./overview.logic";

/** What the sidebar knows without asking each computer more than the daily screens already do. */
export interface AttentionInput {
  readonly machines: ReadonlyArray<
    Pick<OverviewMachine, "environmentId" | "primary" | "connection"> & {
      readonly name: string;
    }
  >;
  readonly runners: ReadonlyArray<Omit<OverviewRunner, "label">>;
  readonly routines: ReadonlyArray<
    Pick<
      OverviewRoutineBrain,
      "key" | "runner" | "routinesStatus" | "pausedRunsPerDay" | "memoryOverLimit"
    >
  >;
  /** The notes folders on connected computers. */
  readonly notes: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly backup: MajordomeBackupStatus;
  }>;
  /** What the assistant did that waits for the owner or could not finish, as the Feed counts it. */
  readonly runs: ReadonlyArray<{ readonly status: FeedRunStatus }>;
  /** Each connected computer's AI accounts; null until they are known. */
  readonly accounts: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly providers: ReadonlyArray<ServerProvider> | null;
  }>;
}

/** A server looks at its notes folders, and claims one nobody runs, at least this often. */
const RUNNER_CLAIM_GRACE_MS = 5 * 60_000;

/**
 * Which computer runs a notes folder's routines, as far as it is settled: a folder made moments ago
 * answers "none" until its server's next look claims it, which is not yet a problem to report.
 */
export function settledRunner(input: {
  /** Null while the folder's history has not answered. */
  readonly runner: MajordomeRoutinesRunner | null;
  /** When the notes folder was added to its computer. */
  readonly createdAt: string;
  /** The current UTC minute, `YYYY-MM-DDTHH:mm`. */
  readonly nowMinute: string;
}): MajordomeRoutinesRunner | null {
  if (input.runner !== "none") return input.runner;
  const age = Date.parse(`${input.nowMinute}Z`) - Date.parse(input.createdAt);
  return age < RUNNER_CLAIM_GRACE_MS ? null : "none";
}

export interface AttentionCard {
  readonly text: string;
  readonly tone: "warning" | "error";
  /** Where the one problem is fixed, or the Status page when there are several. */
  readonly link: OverviewLink | { readonly to: "/settings/overview" };
  readonly count: number;
  /** What pressing the card does, in a word: a waiting question is opened, a problem is fixed. */
  readonly action: "Fix" | "Open";
}

/** The card's few words for a Status line, by the first part of the line's key. */
const SHORT: Record<string, string> = {
  runner: "Routines aren't running",
  blocked: "Routines can't run",
  paused: "Routines paused for today",
  memory: "Memory note is too long",
  provider: "Check your AI account",
};

const STATUS = { to: "/settings/overview" } as const;

/**
 * The sidebar's one card: the Status page's own orange and red lines for what the sidebar knows,
 * red first. Null when nothing needs the owner.
 */
export function attentionCard(input: AttentionInput): AttentionCard | null {
  const where = whereItRunsSection({
    machines: input.machines.map((machine) => ({
      ...machine,
      label: null,
      version: null,
      behind: false,
    })),
    background: null,
    formatSince: String,
    runners: input.runners.map((runner) => ({ ...runner, label: null })),
  });
  const routines = routinesSection({
    brains: input.routines.map((brain) => ({
      ...brain,
      label: null,
      limits: undefined,
      copies: [],
    })),
    loading: false,
    formatNextRun: String,
  });
  const notes = notesSection({
    copies: input.notes.map((copy) => ({
      ...copy,
      key: `${copy.environmentId}:${copy.projectId}`,
      label: null,
      index: { state: "ready", value: null },
    })),
    offline: [],
    loading: false,
    formatAgo: String,
  });
  const access = accessSection({
    machines: input.accounts.map((machine) => ({
      ...machine,
      key: machine.environmentId,
      label: null,
      connected: true,
      secrets: null,
      documents: { state: "loading" },
      pendingRequests: 0,
    })),
    formatAgo: String,
  });
  const { items } = overviewVerdict(needsYouLines(input.runs), [where, routines, notes, access]);
  const [first] = items;
  if (first === undefined || (first.tone !== "error" && first.tone !== "warning")) return null;
  const count = items.reduce((sum, line) => sum + (line.count ?? 1), 0);
  if (count > 1) {
    return {
      text: `${count} things need you`,
      tone: first.tone,
      link: STATUS,
      count,
      action: "Open",
    };
  }

  const said = new Map<string, string>([
    ["runs:waiting", "The assistant is waiting for you"],
    ["runs:failed", "The assistant couldn't finish something"],
    ["runs:stopped", "The assistant was stopped"],
  ]);
  for (const machine of input.machines) {
    said.set(
      `machine:${machine.environmentId}`,
      machine.primary ? "Can't reach your computer" : `Can't reach ${machine.name}`,
    );
  }
  for (const copy of input.notes) {
    const alert = backupAttention(copy.backup);
    if (alert !== null) said.set(`backup:${copy.environmentId}:${copy.projectId}`, alert);
  }
  const kind = first.key.slice(0, first.key.indexOf(":"));
  return {
    text: said.get(first.key) ?? SHORT[kind] ?? first.text,
    tone: first.tone,
    link: first.link ?? STATUS,
    count,
    action: first.key.startsWith("runs:") ? "Open" : "Fix",
  };
}
