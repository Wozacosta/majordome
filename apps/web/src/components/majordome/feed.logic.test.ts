import {
  EnvironmentId,
  type MajordomeVaultHistoryEntry,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFeedItems,
  buildFeedRunItems,
  feedItemTitle,
  feedOwnerEdit,
  groupFeedItems,
  summarizeFeedFiles,
} from "./feed.logic";

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

describe("feedOwnerEdit", () => {
  it("reads the owner's saves and their old sync commits as their edits, with the computer", () => {
    const own = (subject: string) =>
      feedOwnerEdit(entry({ commit: "a", subject, byMajordome: false, authorName: "Me" }));
    expect(own("Your edits")).toEqual({ host: null });
    expect(own("sync(mac): 1 files")).toEqual({ host: "mac" });
    expect(own("sync(ovh-vps): 12 files")).toEqual({ host: "ovh-vps" });
    expect(own("sync(): 1 file")).toEqual({ host: null });
    expect(own("Fix typo")).toBeNull();
    expect(own("sync(mac): notes")).toBeNull();
    expect(feedOwnerEdit(entry({ commit: "b", subject: "Your edits" }))).toBeNull();
    expect(
      feedItemTitle(
        entry({ commit: "c", subject: "sync(mac): 2 files", byMajordome: false, authorName: "Me" }),
      ),
    ).toBe("Your edits");
  });
});

describe("groupFeedItems", () => {
  const save = (commit: string, committedAt: string, subject: string, files: Array<string>) =>
    entry({ commit, subject, committedAt, files, byMajordome: false, authorName: "Me" });

  it("folds a vault's back-to-back saves on one day, broken by any other change to that vault", () => {
    const histories = [
      {
        vault: vault("Notes"),
        entries: [
          save("s6", "2026-11-15T12:30:00Z", "Your edits", ["a.md"]),
          save("s5", "2026-11-15T12:20:00Z", "sync(ovh-vps): 1 files", ["b.md", "a.md"]),
          save("s4", "2026-11-15T12:10:00Z", "sync(mac): 1 files", ["c.md"]),
          entry({ commit: "run", committedAt: "2026-11-15T12:05:00Z" }),
          save("s3", "2026-11-15T12:00:00Z", "Your edits", ["d.md"]),
          save("own", "2026-11-15T11:55:00Z", "Fix typo", ["e.md"]),
          save("s2", "2026-11-15T11:50:00Z", "Your edits", ["f.md"]),
          save("s1", "2026-11-13T12:00:00Z", "Your edits", ["g.md"]),
        ],
      },
      {
        // Another vault's change between saves does not split them.
        vault: vault("Work"),
        entries: [entry({ commit: "work", committedAt: "2026-11-15T12:15:00Z" })],
      },
    ];

    const grouped = groupFeedItems(buildFeedItems(histories, { includeOwnChanges: true }));
    expect(
      grouped.map((row) =>
        row.kind === "edits"
          ? {
              saves: row.saves.map((item) => item.entry.commit),
              files: row.files,
              hosts: row.hosts,
            }
          : row.item.entry.commit,
      ),
    ).toEqual([
      { saves: ["s6", "s5", "s4"], files: ["a.md", "b.md", "c.md"], hosts: ["ovh-vps", "mac"] },
      "work",
      "run",
      "s3",
      "own",
      "s2",
      "s1",
    ]);
    expect(
      groupFeedItems(buildFeedItems(histories, { includeOwnChanges: false })).map(
        (row) => row.kind,
      ),
    ).toEqual(["change", "change"]);
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

type FeedThread = Parameters<typeof buildFeedRunItems>[0][number];

const thread = (
  id: string,
  overrides: Partial<FeedThread> & { readonly run?: "failed" | "completed" | "running" } = {},
): FeedThread => {
  const { run, ...rest } = overrides;
  const at = "2026-11-15T09:00:00.000Z";
  return {
    environmentId: EnvironmentId.make("env-1"),
    id: ThreadId.make(id),
    projectId: ProjectId.make("Notes"),
    title: id,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
    archivedAt: null,
    updatedAt: at,
    pendingUserInputAt: null,
    latestRun:
      run === undefined
        ? null
        : {
            runId: RunId.make(`${id}-run`),
            status: run,
            requestedAt: at,
            startedAt: at,
            completedAt: run === "running" ? null : at,
            assistantMessageId: null,
          },
    runtime:
      run === undefined
        ? null
        : {
            status: run,
            activeRunId: null,
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerName: null,
            lastError: null,
            updatedAt: at,
          },
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    interactionMode: "default",
    blockedOnThreadWait: false,
    lastVisitedAt: null,
    ...rest,
  };
};

describe("buildFeedRunItems", () => {
  it("lists vault runs that wait on the person or failed, newest first, one per thread", () => {
    const vaults = [vault("Notes")];
    const items = buildFeedRunItems(
      [
        thread("approval", {
          run: "running",
          hasPendingApprovals: true,
          latestRun: {
            runId: RunId.make("r"),
            status: "running",
            requestedAt: "2026-11-15T10:00:00.000Z",
            startedAt: "2026-11-15T10:00:01.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
        }),
        thread("question", {
          run: "running",
          hasPendingUserInput: true,
          pendingUserInputAt: "2026-11-15T11:00:00.000Z",
        }),
        thread("failed", { run: "failed" }),
        // A failure the person already opened has settled, as in the sidebar.
        thread("seen-failure", { run: "failed", lastVisitedAt: "2026-11-15T09:30:00.000Z" }),
        thread("done", { run: "completed" }),
        thread("working", { run: "running" }),
        thread("archived", { run: "failed", archivedAt: "2026-11-15T09:10:00.000Z" }),
        thread("subagent", {
          run: "failed",
          lineage: {
            parentThreadId: ThreadId.make("failed"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("failed"),
          },
        }),
        thread("code-project", { run: "failed", projectId: ProjectId.make("Code") }),
      ],
      vaults,
    );
    expect(items.map((item) => [item.title, item.status, item.at])).toEqual([
      ["question", "waiting", "2026-11-15T11:00:00.000Z"],
      ["approval", "waiting", "2026-11-15T10:00:01.000Z"],
      ["failed", "failed", "2026-11-15T09:00:00.000Z"],
    ]);
    expect(items[0]?.vault).toBe(vaults[0]);
  });
});
