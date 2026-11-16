import {
  EnvironmentId,
  type MajordomeVaultHistoryEntry,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFeedItems,
  buildFeedRunItems,
  classifyFeedEntry,
  feedItemTitle,
  feedNotes,
  feedNoteTitle,
  feedOwnerEdit,
  feedRunSummary,
  feedVaultNotes,
  foldOwnChanges,
  groupFeedItems,
  ownDayLine,
  stoppedRunKeys,
  summarizeFeedFiles,
  withDayHeadings,
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

  it("shows a change once per brain, from the server that ran it, named by machine", () => {
    const copyOn = (environmentId: string, machine: string) => ({
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(`brain-${environmentId}`),
      title: "brain",
      brainKey: "brain:root",
      machine,
    });
    const mac = copyOn("mac", "This Mac");
    const vps = copyOn("vps", "Always-on server");
    const shared = [
      entry({
        commit: "undo",
        subject: "Undo: majordome: Start my day",
        body: "Reverts d1d1d1d.",
        committedAt: "2026-11-15T10:00:00Z",
        threadId: "mac-chat",
      }),
      entry({ commit: "edit", subject: "Your edits", byMajordome: false, authorName: "Me" }),
      entry({ commit: "day2", threadId: "vps-run-2", committedAt: "2026-11-15T09:00:00Z" }),
      entry({ commit: "d1d1d1d", threadId: "vps-run-1", committedAt: "2026-11-14T08:00:00Z" }),
    ];
    const items = buildFeedItems(
      [
        { vault: mac, entries: shared },
        {
          vault: vps,
          entries: shared.map((change) =>
            change.commit === "d1d1d1d" ? { ...change, summary: "Planned the day." } : change,
          ),
        },
      ],
      {
        includeOwnChanges: true,
        knownThreads: new Set(["mac:mac-chat", "vps:vps-run-2"]),
      },
    );
    expect(
      items.map((item) => [item.entry.commit, item.vault.environmentId, item.machine, item.undone]),
    ).toEqual([
      ["undo", "mac", "This Mac", false],
      ["day2", "vps", "Always-on server", false],
      ["edit", "mac", null, false],
      ["d1d1d1d", "vps", "Always-on server", true],
    ]);
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
  overrides: Partial<FeedThread> & {
    readonly run?: "failed" | "completed" | "running" | "interrupted";
  } = {},
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
  it("lists vault runs that wait on the person, failed or ran too long, newest first, one per thread", () => {
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
        thread("too-long", { run: "interrupted" }),
        // Stopped by the person, not the time limit.
        thread("stopped-by-owner", { run: "interrupted" }),
        thread("seen-stop", { run: "interrupted", lastVisitedAt: "2026-11-15T09:30:00.000Z" }),
      ],
      vaults,
      stoppedRunKeys([
        {
          environmentId: EnvironmentId.make("env-1"),
          stoppedRuns: [{ runId: "too-long-run" }, { runId: "seen-stop-run" }],
        },
      ]),
    );
    expect(items.map((item) => [item.title, item.status, item.at])).toEqual([
      ["question", "waiting", "2026-11-15T11:00:00.000Z"],
      ["approval", "waiting", "2026-11-15T10:00:01.000Z"],
      ["failed", "failed", "2026-11-15T09:00:00.000Z"],
      ["too-long", "stopped", "2026-11-15T09:00:00.000Z"],
    ]);
    expect(items[0]?.vault).toBe(vaults[0]);
    expect(items.map((item) => item.ownerCardId)).toEqual([null, null, null, null]);

    // A card only the owner can answer, such as a private document request, is named so the feed
    // can offer its answers.
    const [card] = buildFeedRunItems(
      [
        thread("document", {
          run: "running",
          hasPendingUserInput: true,
          source: {
            pendingRuntimeRequest: {
              id: RuntimeRequestId.make("turn-item:private-document:1"),
              kind: "user_input",
              createdAt: DateTime.makeUnsafe("2026-11-15T11:00:00.000Z"),
              blocking: true,
              userOnly: true,
            },
          },
        }),
      ],
      vaults,
    );
    expect(card?.ownerCardId).toBe("turn-item:private-document:1");
  });
});

const localIso = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const NOW = new Date(2026, 10, 15, 12).getTime();

describe("classifyFeedEntry", () => {
  it("tells runs, undos, the owner's saves and their other changes apart", () => {
    expect(
      [
        entry({ commit: "a" }),
        entry({ commit: "b", subject: "Undo: majordome: Start my day" }),
        entry({ commit: "c", subject: "Your edits", byMajordome: false }),
        entry({ commit: "d", subject: "sync(mac): 2 files", byMajordome: false }),
        entry({ commit: "e", subject: "Reorganise", byMajordome: false }),
      ].map(classifyFeedEntry),
    ).toEqual(["run", "undo", "own-edit", "own-edit", "own-change"]);
  });
});

describe("notes", () => {
  const notes = feedVaultNotes({
    folders: { daily: "Journal", inbox: "Inbox" },
    notes: {
      "projects/lisbon.md": "Lisbon move",
      "handover-2026-11-03.md": null,
      "Journal/2026-11-15.md": "Sunday",
    },
  });

  it("names a note by its day, its heading, or its file name", () => {
    expect(
      [
        "Journal/2026-11-15.md",
        "Journal/2026-11-14.md",
        "Journal/2026-11-03.md",
        "Journal/2025-12-31.md",
        "Journal/ideas/2026-11-15.md",
        "projects/lisbon.md",
        "handover-2026-11-03.md",
        "projects/big_plan-v2.md",
      ].map((path) => feedNoteTitle(path, notes, NOW)),
    ).toEqual([
      "Today",
      "Yesterday",
      "Tue 3 Nov",
      "31 Dec 2025",
      "2026-11-15",
      "Lisbon move",
      "handover 2026-11-03",
      "big plan v2",
    ]);
  });

  it("lists notes that still exist first, and only those open", () => {
    const { shown, more } = feedNotes(
      ["Inbox/scan.pdf", ".majordome/runner", "projects/lisbon.md", "Journal/2026-11-15.md"],
      notes,
      NOW,
      2,
    );
    expect(shown.map((note) => [note.title, note.openable])).toEqual([
      ["Lisbon move", true],
      ["Today", true],
    ]);
    expect(more).toBe(1);
  });

  it("says where the inbox went for Digest my inbox, and the reply otherwise", () => {
    const digest = entry({
      commit: "a",
      routine: "digest-my-inbox",
      summary: "Done.",
      files: ["Inbox/a.pdf", "Inbox/b.md", "projects/lisbon-move/a.md", "reading/b.md", "c.md"],
    });
    expect(feedRunSummary(digest, notes)).toBe(
      "Filed 3 notes into Lisbon move, Reading and your notes",
    );
    expect(feedRunSummary({ ...digest, files: ["Inbox/a.pdf"] }, notes)).toBe("Done.");
    expect(feedRunSummary(entry({ commit: "b", summary: "Your day." }), notes)).toBe("Your day.");
    expect(feedRunSummary(entry({ commit: "c" }), notes)).toBeNull();
  });
});

describe("foldOwnChanges", () => {
  it("folds the owner's changes into one line a day, where that day's newest was", () => {
    const own = (commit: string, day: number, hour: number, files: Array<string>) =>
      entry({
        commit,
        subject: "Your edits",
        byMajordome: false,
        committedAt: localIso(day, hour),
        files,
      });
    const items = buildFeedItems(
      [
        {
          vault: vault("Notes"),
          entries: [
            own("o4", 15, 11, ["a.md", "b.md"]),
            entry({ commit: "r2", committedAt: localIso(15, 10) }),
            own("o3", 15, 9, ["b.md", "c.md", "d.md"]),
            own("o2", 14, 20, ["a.md"]),
            entry({ commit: "r1", committedAt: localIso(3, 8) }),
            own("o1", 3, 7, ["a.md", "e.md"]),
          ],
        },
      ],
      { includeOwnChanges: true },
    );
    const timeline = foldOwnChanges(items);
    expect(
      timeline.map((row) =>
        row.kind === "own-day"
          ? `${ownDayLine(row, NOW)} (${row.items.map((item) => item.entry.commit).join(",")})`
          : row.item.entry.commit,
      ),
    ).toEqual([
      "You edited 4 notes today (o4,o3)",
      "r2",
      "You edited 1 note yesterday (o2)",
      "r1",
      "You edited 2 notes on Tue 3 Nov (o1)",
    ]);
    // One heading where each day starts.
    expect(
      withDayHeadings(
        timeline,
        (row) => (row.kind === "own-day" ? row.at : row.item.entry.committedAt),
        NOW,
      ).map(({ day }) => day),
    ).toEqual(["Today", null, "Yesterday", "Tue 3 Nov", null]);
  });
});
