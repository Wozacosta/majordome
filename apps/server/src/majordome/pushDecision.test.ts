import { describe, expect, it } from "@effect/vitest";
import {
  type EnvironmentId,
  ProviderInstanceId,
  RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { routineTaskId } from "./defaultRoutines.ts";
import {
  decideVaultPush,
  firstReplyLine,
  isStartMyDayTask,
  makePushDedupe,
  type VaultPushThread,
} from "./pushDecision.ts";

const updatedAt = DateTime.makeUnsafe("2026-11-15T08:00:00.000Z");

const thread = (overrides: Partial<VaultPushThread> = {}): VaultPushThread => ({
  id: "thread-1" as ThreadId,
  lineage: {
    rootThreadId: "thread-1" as ThreadId,
    parentThreadId: null,
    relationshipToParent: null,
  },
  title: "Start my day",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku" },
  status: "running",
  pendingRuntimeRequest: null,
  settledOverride: null,
  updatedAt,
  latestRunId: "run-1",
  ...overrides,
});

const decide = (
  overrides: Partial<VaultPushThread>,
  startMyDayReply?: string | null,
): ReturnType<typeof decideVaultPush> =>
  decideVaultPush({
    environmentId: "env-1" as EnvironmentId,
    projectTitle: "Brain",
    thread: thread(overrides),
    ...(startMyDayReply === undefined ? {} : { startMyDayReply }),
  });

describe("decideVaultPush", () => {
  it.each([
    ["approval", "command", "Start my day needs your OK."],
    ["question", "user_input", "Start my day has a question."],
  ] as const)("tells the owner a run waits for their %s", (_name, kind, body) => {
    expect(
      decide({
        status: "running",
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-7"),
          kind,
          createdAt: updatedAt,
        },
      }),
    ).toEqual({
      kind: "waiting",
      dedupeKey: "waiting:thread-1:request-7",
      title: "Waiting for you",
      body,
      tag: "majordome:thread-1",
      url: "/threads/env-1/thread-1",
    });
  });

  it("does not count a sign-in refresh as waiting", () => {
    expect(
      decide({
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-auth"),
          kind: "auth_refresh",
          createdAt: updatedAt,
        },
      }),
    ).toBeNull();
  });

  it("tells the owner a run couldn't finish, once per run", () => {
    expect(decide({ status: "failed", latestRunId: "run-3" })).toMatchObject({
      kind: "failed",
      dedupeKey: "failed:thread-1:run-3",
      title: "Couldn't finish",
      body: "Start my day",
    });
  });

  it("sends the first line of Start my day's reply when it finishes", () => {
    expect(
      decide({ status: "completed" }, "## Good morning\n\nThree things today.\n- Call the bank"),
    ).toMatchObject({
      kind: "start-my-day",
      dedupeKey: "done:thread-1:run-1",
      title: "Start my day",
      body: "Good morning",
    });
    expect(decide({ status: "completed" }, "")).toMatchObject({ body: "Your day is ready." });
  });

  it.each([
    ["any other finished run", { status: "completed" as const }, null],
    ["a run still working", { status: "running" as const }, "Hello"],
    ["a run the owner stopped", { status: "interrupted" as const }, null],
    [
      "a stopped run that completed",
      { status: "completed" as const, latestRunStopRequested: true },
      "Hi",
    ],
    [
      "a dismissed failure",
      { status: "failed" as const, settledOverride: "settled" as const },
      null,
    ],
    [
      "a subagent's run",
      {
        status: "failed" as const,
        lineage: {
          rootThreadId: "thread-0" as ThreadId,
          parentThreadId: "thread-0" as ThreadId,
          relationshipToParent: "subagent" as const,
        },
      },
      null,
    ],
  ])("stays quiet for %s", (_name, overrides, reply) => {
    expect(decide(overrides, reply)).toBeNull();
  });
});

describe("isStartMyDayTask", () => {
  it("recognizes only the Start my day routine", () => {
    expect(isStartMyDayTask(routineTaskId("project-1" as never, "start-my-day"))).toBe(true);
    expect(isStartMyDayTask(routineTaskId("project-1" as never, "review-my-week"))).toBe(false);
    expect(isStartMyDayTask("my-own-task")).toBe(false);
    expect(isStartMyDayTask(undefined)).toBe(false);
  });
});

describe("firstReplyLine", () => {
  it.each([
    ["Plain first line\nsecond", "Plain first line"],
    ["\n\n# **Today**: focus\nmore", "Today: focus"],
    ["- [ ] Call [the bank](https://bank.example)", "Call the bank"],
    ["---\n> 1. Ship `M3`", "Ship M3"],
    ["```\ncode\n```", "code"],
    ["   \n\n", null],
  ])("reads %j as %j", (text, expected) => {
    expect(firstReplyLine(text)).toBe(expected);
  });

  it("shortens a long line for the lock screen", () => {
    const line = firstReplyLine("word ".repeat(60));
    expect(line?.length).toBeLessThanOrEqual(140);
    expect(line?.endsWith("…")).toBe(true);
  });
});

describe("makePushDedupe", () => {
  it("lets each key through once and forgets the oldest past capacity", () => {
    const firstTime = makePushDedupe(2);
    expect(firstTime("a")).toBe(true);
    expect(firstTime("a")).toBe(false);
    expect(firstTime("b")).toBe(true);
    expect(firstTime("c")).toBe(true);
    expect(firstTime("a")).toBe(true);
    expect(firstTime("c")).toBe(false);
  });
});
