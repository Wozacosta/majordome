import type { MajordomeProposedSkill, MajordomeSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { skillOfPath, skillRows, skillsView, skillTitle } from "./skills.logic";

const skill = (
  name: string,
  source: MajordomeSkill["source"],
  description = "",
): MajordomeSkill => ({ name, description, text: "Steps.", source });
const waiting = (
  name: string,
  options: Partial<Pick<MajordomeProposedSkill, "replaces" | "stopped" | "source">> = {},
): MajordomeProposedSkill => ({
  ...skill(name, options.source ?? "assistant"),
  replaces: options.replaces ?? false,
  stopped: options.stopped ?? false,
});

const rows = skillRows({
  skills: [
    skill("recap", "majordome", "Use when the owner says wrap up."),
    skill("file-receipts", "assistant", "Files a scanned receipt."),
    skill("tax-letter", "other"),
  ],
  proposed: [
    waiting("weekly", { stopped: true, source: "majordome" }),
    waiting("recap", { replaces: true }),
    waiting("invoice-reminders"),
  ],
});
const shown = (view: ReturnType<typeof skillsView>) =>
  view.groups.map((group) => [group.state, group.rows.map((row) => row.title)]);

describe("skillTitle", () => {
  it("reads a folder name as words", () => {
    expect(skillTitle("file-receipts")).toBe("File receipts");
    expect(skillOfPath(".agents/proposed-skills/file-receipts/SKILL.md")).toBe("file-receipts");
  });
});

describe("skillsView", () => {
  it("lists what waits for a yes first, then what is in use, then what was switched off", () => {
    const view = skillsView(rows, { query: "", source: "all" });
    expect(shown(view)).toEqual([
      ["waiting", ["Invoice reminders", "Recap"]],
      ["inUse", ["File receipts", "Recap", "Tax letter"]],
      ["off", ["Weekly"]],
    ]);
    expect(view.hiddenWaiting).toBe(0);
  });

  it("keeps a skill in use and its new version apart", () => {
    const recaps = rows.filter((row) => row.name === "recap");
    expect(recaps.map((row) => [row.key, row.state, row.replaces, row.path])).toEqual([
      ["waiting:recap", "waiting", true, ".agents/proposed-skills/recap/SKILL.md"],
      ["in-use:recap", "inUse", false, ".agents/skills/recap/SKILL.md"],
    ]);
  });

  it("counts skills by where they come from, and narrows to one source", () => {
    const view = skillsView(rows, { query: "", source: "majordome" });
    expect(view.tabs).toEqual([
      { source: "all", count: 6 },
      { source: "assistant", count: 3 },
      { source: "majordome", count: 2 },
      { source: "other", count: 1 },
    ]);
    expect(shown(view)).toEqual([
      ["inUse", ["Recap"]],
      ["off", ["Weekly"]],
    ]);
    // What waits is never lost behind a filter: the page says how many it left out.
    expect(view.hiddenWaiting).toBe(2);
  });

  it("finds a skill by its name or by when it is used, whatever the case", () => {
    expect(shown(skillsView(rows, { query: "RECEIPT", source: "all" }))).toEqual([
      ["inUse", ["File receipts"]],
    ]);
    const byUse = skillsView(rows, { query: "wrap  owner", source: "all" });
    expect(shown(byUse)).toEqual([["inUse", ["Recap"]]]);
    expect(byUse.tabs.map((tab) => tab.count)).toEqual([1, 0, 1, 0]);
    expect(byUse.hiddenWaiting).toBe(2);
    expect(skillsView(rows, { query: "nothing like this", source: "all" }).groups).toEqual([]);
  });

  it("offers no sources to choose between when there is only one", () => {
    const one = skillRows({ skills: [skill("recap", "majordome")], proposed: [] });
    const view = skillsView(one, { query: "", source: "assistant" });
    expect(view.tabs).toEqual([]);
    // A source nothing comes from any more does not hide every skill.
    expect(view.source).toBe("all");
    expect(shown(view)).toEqual([["inUse", ["Recap"]]]);
  });
});
