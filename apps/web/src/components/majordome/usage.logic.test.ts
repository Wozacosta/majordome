import type { MajordomeUsageByUse, MajordomeUsageUse, UsageProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { usageGauges, usageUseRows } from "./usage.logic";

const use = (
  kind: MajordomeUsageUse["kind"],
  id: string,
  label: string,
  runs: number,
  claude: readonly [costUsd: number, tokens: number],
  codex?: readonly [costUsd: number, tokens: number],
): MajordomeUsageUse => ({
  kind,
  id,
  label,
  runs,
  byProvider: [
    { provider: "claude", costUsd: claude[0], tokens: claude[1] },
    ...(codex ? [{ provider: "codex" as const, costUsd: codex[0], tokens: codex[1] }] : []),
  ],
});

const mac: MajordomeUsageByUse = {
  uses: [
    use("routine", "majordome:a:start-my-day", "Start my day", 20, [2, 200]),
    use("routine", "scheduled-task:gone", "", 1, [0.5, 50]),
    use("topic", "fitness", "Fitness", 6, [3, 300], [1, 1000]),
    use("topic", "money", "Money", 2, [1, 100]),
    use("chat", "", "", 4, [0.5, 50]),
    use("outside", "", "", 0, [12, 1200]),
  ],
};
const hosted: MajordomeUsageByUse = {
  uses: [
    use("routine", "majordome:b:start-my-day", "Start my day", 10, [1, 100]),
    use("topic", "fitness", "Fitness", 1, [1, 100]),
  ],
};
const none: ReadonlySet<UsageProviderKind> = new Set();

const brief = (rows: ReturnType<typeof usageUseRows>) =>
  rows.map((row) => [row.kind, row.label, row.costUsd, row.tokens, row.runs]);

describe("usageUseRows", () => {
  it("lists routines largest first, then the chats and what is not a chat, adding up to the total", () => {
    const rows = usageUseRows({
      cut: "routine",
      answers: [mac, hosted],
      hiddenProviders: none,
      metric: "cost",
    });
    expect(brief(rows)).toEqual([
      // The same routine on two servers is one row.
      ["routine", "Start my day", 3, 300, 30],
      ["routine", "A removed routine", 0.5, 50, 1],
      ["chats", "Chats", 6.5, 1550, 13],
      ["outside", "Outside Majordome", 12, 1200, 0],
    ]);
    expect(rows.reduce((sum, row) => sum + (row.share ?? 0), 0)).toBeCloseTo(1);
    expect(rows[0]?.share).toBeCloseTo(3 / 22);
  });

  it("lists topics, then the other chats, the routines and what is not a chat", () => {
    const rows = usageUseRows({
      cut: "topic",
      answers: [mac, hosted],
      hiddenProviders: none,
      metric: "cost",
    });
    expect(brief(rows)).toEqual([
      ["topic", "Fitness", 5, 1400, 7],
      ["topic", "Money", 1, 100, 2],
      ["routines", "Routines", 3.5, 350, 31],
      ["chat", "Other chats", 0.5, 50, 4],
      ["outside", "Outside Majordome", 12, 1200, 0],
    ]);
  });

  it("ranks and shares by tokens when tokens are shown, and leaves hidden AIs out", () => {
    const byTokens = usageUseRows({
      cut: "topic",
      answers: [mac],
      hiddenProviders: none,
      metric: "tokens",
    });
    expect(byTokens.slice(0, 2).map((row) => [row.label, row.tokens])).toEqual([
      ["Fitness", 1300],
      ["Money", 100],
    ]);
    expect(byTokens[0]?.share).toBeCloseTo(1300 / 2900);

    const claudeOnly = usageUseRows({
      cut: "topic",
      answers: [mac],
      hiddenProviders: new Set(["codex"]),
      metric: "tokens",
    });
    expect(claudeOnly[0]).toMatchObject({ label: "Fitness", tokens: 300, costUsd: 3 });
  });

  it("keeps a routine that ran but has no usage on record, and has no share without usage", () => {
    const rows = usageUseRows({
      cut: "routine",
      answers: [
        { uses: [{ kind: "routine", id: "r", label: "Tidy my memory", runs: 3, byProvider: [] }] },
      ],
      hiddenProviders: none,
      metric: "cost",
    });
    expect(rows).toEqual([
      {
        key: "label:Tidy my memory",
        kind: "routine",
        label: "Tidy my memory",
        costUsd: 0,
        tokens: 0,
        runs: 3,
        share: null,
      },
    ]);
    expect(
      usageUseRows({ cut: "topic", answers: [], hiddenProviders: none, metric: "cost" }),
    ).toEqual([]);
  });
});

describe("usageGauges", () => {
  const window = (
    id: string,
    kind: "session" | "weekly" | "monthly" | "other",
    usedPercent: number,
    modelIds?: ReadonlyArray<string>,
  ) => ({
    id,
    kind,
    label: `${id} limit`,
    usedPercent,
    members: [{ window: modelIds === undefined ? {} : { modelIds } }],
  });

  it("shows the session and the week, shortest first, not one model's own limit", () => {
    expect(
      usageGauges([
        window("weekly-fable", "weekly", 91, ["claude-fable-5"]),
        window("weekly", "weekly", 70),
        window("five-hour", "session", 42),
        window("monthly", "monthly", 10),
      ]),
    ).toEqual([
      { key: "five-hour", label: "Session", usedPercent: 42 },
      { key: "weekly", label: "Week", usedPercent: 70 },
    ]);
  });

  it("names a window of another kind as its provider does, and keeps to 0-100", () => {
    expect(usageGauges([window("credits", "other", 140)])).toEqual([
      { key: "credits", label: "credits limit", usedPercent: 100 },
    ]);
  });
});
