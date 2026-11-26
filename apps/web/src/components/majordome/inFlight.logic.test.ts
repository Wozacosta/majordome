import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFeedRunItems } from "./feed.logic";
import { capInFlight, inFlightPlaces, selectInFlight } from "./inFlight.logic";
import { needsYouLines } from "./overview.logic";

type Thread = Parameters<typeof selectInFlight>[0]["threads"][number];
type Run = "failed" | "completed" | "running" | "interrupted";

const MAC = EnvironmentId.make("env-mac");
const HOSTED = EnvironmentId.make("env-hosted");
const NOTES = ProjectId.make("notes");
const vaults = [
  { environmentId: MAC, projectId: NOTES, title: "Notes" },
  { environmentId: HOSTED, projectId: NOTES, title: "Notes" },
];

const thread = (
  id: string,
  overrides: Partial<Thread> & { readonly run?: Run; readonly at?: string } = {},
): Thread => {
  const { run, at = "2026-11-26T09:00:00.000Z", ...rest } = overrides;
  return {
    environmentId: MAC,
    id: ThreadId.make(id),
    projectId: NOTES,
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
    settledOverride: null,
    ...rest,
  };
};

/** Opened before its last run finished, so the reply is unread. */
const UNREAD = { run: "completed", lastVisitedAt: "2026-11-26T08:00:00.000Z" } as const;
/** Opened after its last run finished. */
const READ = { run: "completed", lastVisitedAt: "2026-11-26T10:00:00.000Z" } as const;

const rows = (group: ReturnType<typeof selectInFlight>["needsYou"]) =>
  group.map((row) => `${row.title}: ${row.state}`);

describe("selectInFlight", () => {
  it("puts each state in its group, in the words the chat lists use", () => {
    const inFlight = selectInFlight({
      threads: [
        thread("Book the flights", { run: "running", hasPendingApprovals: true }),
        thread("Plan the trip", { run: "running", hasPendingUserInput: true }),
        thread("Digest my inbox", { run: "failed" }),
        thread("Summarise the meeting", UNREAD),
        thread("Review the lease", { ...UNREAD, pendingGuestMessageCount: 1 }),
        thread("Find a dentist", { run: "running" }),
        thread("Sort the receipts", { run: "running", blockedOnThreadWait: true }),
        thread("Read yesterday", READ),
        thread("Never written in"),
      ],
      vaults,
    });
    expect(rows(inFlight.needsYou)).toEqual([
      "Book the flights: Needs your OK",
      "Digest my inbox: Couldn't finish",
      "Plan the trip: Waiting for your answer",
      "Review the lease: A guest wrote",
      "Summarise the meeting: New reply",
    ]);
    expect(inFlight.needsYou.map((row) => row.mark)).toEqual([
      "asking",
      "failed",
      "asking",
      "asking",
      "answered",
    ]);
    expect(rows(inFlight.working)).toEqual([
      "Find a dentist: Working",
      "Sort the receipts: Working in the background",
    ]);
  });

  it("is empty while nothing is going on", () => {
    expect(
      selectInFlight({ threads: [thread("Read yesterday", READ), thread("Empty")], vaults }),
    ).toEqual({ needsYou: [], working: [] });
  });

  it("alerts exactly the chats the sidebar's card counts", () => {
    const threads = [
      thread("Book the flights", { run: "running", hasPendingApprovals: true }),
      thread("Digest my inbox", { run: "failed" }),
      thread("Summarise the meeting", UNREAD),
      thread("Find a dentist", { run: "running" }),
    ];
    const card = needsYouLines(buildFeedRunItems(threads, vaults));
    const alerted = selectInFlight({ threads, vaults }).needsYou.filter((row) => row.alerted);
    expect(alerted.map((row) => row.title)).toEqual(["Book the flights", "Digest my inbox"]);
    expect(card.reduce((sum, line) => sum + (line.count ?? 1), 0)).toBe(alerted.length);
  });

  it("lists a run the time limit stopped, which the card is not told about", () => {
    const stopped = thread("Start my day", { run: "interrupted" });
    const { needsYou } = selectInFlight({
      threads: [stopped],
      vaults,
      stoppedRuns: new Set([`${MAC}:Start my day-run`]),
    });
    expect(needsYou.map((row) => [row.state, row.mark, row.alerted])).toEqual([
      ["Stopped: ran too long", "failed", false],
    ]);
  });

  it("covers every server's copy of the notes folder, and nothing outside it", () => {
    const { working } = selectInFlight({
      threads: [
        thread("On the Mac", { run: "running", at: "2026-11-26T09:00:00.000Z" }),
        thread("On the server", {
          run: "running",
          environmentId: HOSTED,
          at: "2026-11-26T09:30:00.000Z",
        }),
        thread("Some code", { run: "running", projectId: ProjectId.make("code") }),
        thread("Archived", { run: "running", archivedAt: "2026-11-26T09:00:00.000Z" }),
        thread("A helper", {
          run: "running",
          lineage: {
            parentThreadId: ThreadId.make("On the Mac"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("On the Mac"),
          },
        }),
      ],
      vaults,
    });
    expect(working.map((row) => [row.title, row.environmentId])).toEqual([
      ["On the server", HOSTED],
      ["On the Mac", MAC],
    ]);
  });

  it("leaves out a reply in a chat marked as done, and names an unnamed chat", () => {
    const inFlight = selectInFlight({
      threads: [
        thread("Done with", { ...UNREAD, settledOverride: "settled" }),
        thread("t-new", { run: "running", title: "New thread" }),
      ],
      vaults,
    });
    expect(inFlight.needsYou).toEqual([]);
    expect(inFlight.working.map((row) => row.title)).toEqual(["New chat"]);
  });

  it("names a topic's conversation after the topic, and says where the others belong", () => {
    const places = inFlightPlaces(
      {
        topics: [
          {
            id: "taxes",
            title: "Taxes",
            threadId: ThreadId.make("t-taxes"),
            threadEnvironmentId: MAC,
            sideChats: [{ environmentId: MAC, threadId: ThreadId.make("t-side") }],
          } as never,
        ],
      },
      new Set([`${MAC}:t-routine`]),
    );
    const { working } = selectInFlight({
      threads: [
        thread("t-taxes", { run: "running", title: "Topic: Taxes" }),
        thread("t-side", { run: "running", title: "Which form?" }),
        thread("t-routine", { run: "running", title: "Start my day" }),
        thread("t-plain", { run: "running", title: "Find a dentist" }),
      ],
      vaults,
      places,
    });
    // What a routine did is under "Lately in your notes"; only its question or failure needs him.
    const finished = [
      thread("t-routine", { ...UNREAD, title: "Start my day" }),
      thread("t-side", { ...UNREAD, title: "Which form?" }),
    ];
    expect(rows(selectInFlight({ threads: finished, vaults, places }).needsYou)).toEqual([
      "Which form?: New reply",
    ]);
    const asking = [thread("t-routine", { run: "running", hasPendingUserInput: true })];
    expect(selectInFlight({ threads: asking, vaults, places }).needsYou).toHaveLength(1);
    expect(Object.fromEntries(working.map((row) => [row.title, row.place]))).toEqual({
      Taxes: null,
      "Which form?": "Taxes",
      "Start my day": "Routine",
      "Find a dentist": null,
    });
  });
});

describe("capInFlight", () => {
  it("shows a few rows and counts the rest, until asked for all", () => {
    expect(capInFlight([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capInFlight([1, 2, 3, 4, 5], false)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capInFlight([1, 2, 3, 4, 5], true)).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
  });
});
