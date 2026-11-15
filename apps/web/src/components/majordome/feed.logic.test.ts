import {
  EnvironmentId,
  type MajordomeVaultHistoryEntry,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFeedItems, buildFeedRunItems, feedItemTitle, summarizeFeedFiles } from "./feed.logic";

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
