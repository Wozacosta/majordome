import type {
  MajordomeUsageByUse,
  MajordomeUsageUseKind,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";

/** The cuts Majordome adds to the usage page's breakdown, beside its own by model and by day. */
export const USAGE_USE_CUTS = [
  { value: "routine", label: "Routine" },
  { value: "topic", label: "Topic" },
] as const;
export type UsageUseCut = (typeof USAGE_USE_CUTS)[number]["value"];

export function isUsageUseCut(value: string | null | undefined): value is UsageUseCut {
  return USAGE_USE_CUTS.some((cut) => cut.value === value);
}

export interface UsageUseRow {
  readonly key: string;
  /**
   * `routines` and `chats` are everything of that sort in one row, for the cut that is not about
   * them.
   */
  readonly kind: MajordomeUsageUseKind | "routines" | "chats";
  readonly label: string;
  readonly costUsd: number;
  readonly tokens: number;
  readonly runs: number;
  /** Of every row together, by the metric shown; null when there is nothing to share. */
  readonly share: number | null;
}

const REST_LABEL = {
  routine: "A removed routine",
  topic: "A removed topic",
  chat: "Other chats",
  outside: "Outside Majordome",
  routines: "Routines",
  chats: "Chats",
} as const satisfies Record<UsageUseRow["kind"], string>;

interface Sum {
  costUsd: number;
  tokens: number;
  runs: number;
}

/**
 * The rows of one cut, from each server's answer. A routine or topic of the same name on two
 * servers is one row: a brain's topics are the same on each of its servers. The cut's own rows come
 * first, largest first, then what it is not about, so the rows always add up to the total.
 */
export function usageUseRows(input: {
  readonly cut: UsageUseCut;
  readonly answers: ReadonlyArray<MajordomeUsageByUse>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly metric: "cost" | "tokens";
}): ReadonlyArray<UsageUseRow> {
  const own = new Map<string, Sum & { label: string }>();
  const rest = new Map<UsageUseRow["kind"], Sum>();
  const restKind = (kind: MajordomeUsageUseKind): UsageUseRow["kind"] => {
    if (kind === "outside") return "outside";
    if (input.cut === "routine") return "chats";
    return kind === "routine" ? "routines" : "chat";
  };
  for (const use of input.answers.flatMap((answer) => answer.uses)) {
    let costUsd = 0;
    let tokens = 0;
    for (const entry of use.byProvider) {
      if (input.hiddenProviders.has(entry.provider)) continue;
      costUsd += entry.costUsd;
      tokens += entry.tokens;
    }
    let sum: Sum;
    if (use.kind === input.cut) {
      const key = use.label === "" ? `id:${use.id}` : `label:${use.label}`;
      let row = own.get(key);
      if (row === undefined) {
        row = { label: use.label, costUsd: 0, tokens: 0, runs: 0 };
        own.set(key, row);
      }
      sum = row;
    } else {
      const kind = restKind(use.kind);
      sum = rest.get(kind) ?? { costUsd: 0, tokens: 0, runs: 0 };
      rest.set(kind, sum);
    }
    sum.costUsd += costUsd;
    sum.tokens += tokens;
    sum.runs += use.runs;
  }

  const value = (sum: Sum) => (input.metric === "cost" ? sum.costUsd : sum.tokens);
  const total = [...own.values(), ...rest.values()].reduce((all, sum) => all + value(sum), 0);
  const row = (key: string, kind: UsageUseRow["kind"], label: string, sum: Sum): UsageUseRow => ({
    key,
    kind,
    label: label === "" ? REST_LABEL[kind] : label,
    costUsd: sum.costUsd,
    tokens: sum.tokens,
    runs: sum.runs,
    share: total > 0 ? value(sum) / total : null,
  });
  const shown = (sum: Sum) => sum.tokens > 0 || sum.costUsd > 0 || sum.runs > 0;
  return [
    ...[...own]
      .filter(([, sum]) => shown(sum))
      .toSorted(
        ([, left], [, right]) =>
          value(right) - value(left) ||
          right.runs - left.runs ||
          left.label.localeCompare(right.label),
      )
      .map(([key, sum]) => row(key, input.cut, sum.label, sum)),
    ...(["chats", "routines", "chat", "outside"] as const).flatMap((kind) => {
      const sum = rest.get(kind);
      return sum === undefined || !shown(sum) ? [] : [row(kind, kind, "", sum)];
    }),
  ];
}

export interface UsageGauge {
  readonly key: string;
  /** Session, Week, Month, or the provider's own name for another window. */
  readonly label: string;
  /** 0 to 100. */
  readonly usedPercent: number;
}

const GAUGE_LABEL: Partial<Record<ServerProviderUsageWindow["kind"], string>> = {
  session: "Session",
  weekly: "Week",
  monthly: "Month",
};

/**
 * The small gauges for one plan: its windows that count everything (not one model's), the
 * shortest first, two at most.
 */
export function usageGauges(
  windows: ReadonlyArray<{
    readonly id: string;
    readonly kind: ServerProviderUsageWindow["kind"];
    readonly label: string;
    readonly usedPercent: number;
    readonly members: ReadonlyArray<{
      readonly window: Pick<ServerProviderUsageWindow, "modelIds">;
    }>;
  }>,
): ReadonlyArray<UsageGauge> {
  const order = { session: 0, weekly: 1, monthly: 2, other: 3 } as const;
  return windows
    .filter((window) => window.members.every((member) => member.window.modelIds === undefined))
    .toSorted((left, right) => order[left.kind] - order[right.kind])
    .slice(0, 2)
    .map((window) => ({
      key: window.id,
      label: GAUGE_LABEL[window.kind] ?? window.label,
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
    }));
}
