import { EnvironmentId, type MajordomeVaultHistoryEntry, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFeedItems, feedItemTitle, summarizeFeedFiles } from "./feed.logic";

const entry = (
  overrides: Partial<MajordomeVaultHistoryEntry> & Pick<MajordomeVaultHistoryEntry, "commit">,
): MajordomeVaultHistoryEntry => ({
  subject: "majordome: Start my day",
  body: "",
  authorName: "Majordome",
  committedAt: "2026-11-15T08:00:00+01:00",
  byMajordome: true,
  threadId: null,
  files: [],
  ...overrides,
});

const vault = (title: string) => ({
  environmentId: EnvironmentId.make("env-1"),
  projectId: ProjectId.make(title),
  title,
});

describe("feedItemTitle", () => {
  it("names runs by their thread and undos by what they undid", () => {
    expect(feedItemTitle(entry({ commit: "a" }))).toBe("Start my day");
    expect(feedItemTitle(entry({ commit: "b", subject: "Undo: majordome: Wrong guess" }))).toBe(
      "Undid “Wrong guess”",
    );
    expect(
      feedItemTitle(
        entry({ commit: "c", subject: "majordome: notes", byMajordome: false, authorName: "Me" }),
      ),
    ).toBe("majordome: notes");
  });
});

describe("buildFeedItems", () => {
  it("merges vaults newest first, marks undone runs and can hide the owner's changes", () => {
    const histories = [
      {
        vault: vault("Notes"),
        entries: [
          entry({
            commit: "c3c3c3c",
            subject: "Undo: majordome: Wrong guess",
            body: "Reverts c1c1c1c.",
            committedAt: "2026-11-15T10:00:00Z",
          }),
          entry({
            commit: "c2c2c2c",
            subject: "Fix typo",
            byMajordome: false,
            authorName: "Me",
            committedAt: "2026-11-15T09:30:00Z",
          }),
          entry({
            commit: "c1c1c1c",
            subject: "majordome: Wrong guess",
            committedAt: "2026-11-15T09:00:00Z",
          }),
        ],
      },
      {
        vault: vault("Work"),
        entries: [entry({ commit: "e1e1e1e", committedAt: "2026-11-15T09:45:00Z" })],
      },
    ];

    const all = buildFeedItems(histories, { includeOwnChanges: true });
    expect(all.map((item) => [item.entry.commit, item.undone])).toEqual([
      ["c3c3c3c", false],
      ["e1e1e1e", false],
      ["c2c2c2c", false],
      ["c1c1c1c", true],
    ]);
    expect(
      buildFeedItems(histories, { includeOwnChanges: false }).map((item) => item.entry.commit),
    ).toEqual(["c3c3c3c", "e1e1e1e", "c1c1c1c"]);
  });
});

describe("summarizeFeedFiles", () => {
  it("keeps the first notes and counts the rest", () => {
    expect(summarizeFeedFiles(["a.md", "b.md", "c.md"], 2)).toEqual({
      shown: ["a.md", "b.md"],
      more: 1,
    });
  });
});
