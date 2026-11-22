import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assistantCanAnswer,
  conversationHome,
  conversationHomes,
  finishedReplies,
  type HomeCopy,
  keepsConversations,
  replyFinishedSince,
} from "./home.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const onMac = ProjectId.make("brain-mac");
const onServer = ProjectId.make("brain-server");

const copy = (
  environmentId: EnvironmentId,
  routinesRunner: HomeCopy["routinesRunner"],
  overrides: Partial<HomeCopy> = {},
): HomeCopy => ({
  environmentId,
  projectId: environmentId === mac ? onMac : onServer,
  brainId: "root",
  routinesRunner,
  assistantReady: true,
  ...overrides,
});
const here = { kind: "ready", environmentId: mac, projectId: onMac };
const there = { kind: "ready", environmentId: server, projectId: onServer };

describe("conversationHome", () => {
  it.each([
    ["no always-on server: this computer", [mac], [copy(mac, "this-server")], here],
    ["no routines anywhere yet: this computer", [mac], [copy(mac, "none")], here],
    [
      "an always-on server that can answer: the server",
      [mac, server],
      [copy(mac, "another-server"), copy(server, "this-server")],
      there,
    ],
    [
      "the server is connected but its AI is signed out: this computer",
      [mac, server],
      [copy(mac, "another-server"), copy(server, "this-server", { assistantReady: false })],
      here,
    ],
    [
      "the server is known but not connected: nowhere, rather than splitting a topic's history",
      [mac],
      [copy(mac, "another-server"), copy(server, "this-server")],
      { kind: "unreachable" },
    ],
    [
      "the server's notes were never listed here: still not on this computer",
      [mac],
      [copy(mac, "another-server")],
      { kind: "unreachable" },
    ],
    [
      "a connected computer has not answered yet: wait",
      [mac, server],
      [copy(mac, "another-server"), copy(server, undefined)],
      { kind: "loading" },
    ],
    [
      "a computer that could not answer is not waited for",
      [mac, server],
      [copy(mac, "this-server"), copy(server, null)],
      here,
    ],
    [
      "this computer runs the routines and another one only holds the notes: this computer",
      [mac, server],
      [copy(mac, "this-server"), copy(server, "another-server")],
      here,
    ],
    [
      "on the phone, the server is this window's own computer",
      [server],
      [copy(server, "this-server")],
      there,
    ],
  ] as const)("%s", (_name, connected, copies, expected) => {
    const [shown, ...others] = copies;
    expect(
      conversationHome({
        primaryEnvironmentId: shown.environmentId,
        connected,
        copies: [shown, ...others],
      }),
    ).toEqual(expected);
  });

  it("waits while a connected computer has not said which notes it holds", () => {
    const input = { primaryEnvironmentId: mac, connected: [mac], copies: [copy(mac, "none")] };
    expect(conversationHome({ ...input, copies: [input.copies[0]!], waiting: true })).toEqual({
      kind: "loading",
    });
  });

  it("gives every copy of a notes folder the same home, and each notes folder its own", () => {
    const work = copy(mac, "this-server", { projectId: ProjectId.make("work"), brainId: "work" });
    const homes = conversationHomes({
      primaryEnvironmentId: mac,
      connected: [mac, server],
      copies: [copy(server, "this-server"), copy(mac, "another-server"), work],
    });
    const key = (environmentId: EnvironmentId, projectId: ProjectId) =>
      scopedProjectKey({ environmentId, projectId });
    expect(homes.get(key(mac, onMac))).toEqual(there);
    expect(homes.get(key(server, onServer))).toEqual(there);
    expect(homes.get(key(mac, work.projectId))).toEqual({ ...here, projectId: work.projectId });
    // The Status page says so on the server's line, and only there.
    expect(keepsConversations(copy(server, "this-server"), mac, homes)).toBe(true);
    expect(keepsConversations(copy(mac, "another-server"), mac, homes)).toBe(false);
    expect(keepsConversations(work, mac, homes)).toBe(false);
  });

  it("takes a server as able to answer unless its AI is missing or signed out", () => {
    expect(assistantCanAnswer(undefined)).toBe(true);
    expect(assistantCanAnswer({ ready: true })).toBe(true);
    expect(assistantCanAnswer({ ready: false, reason: "not-created" })).toBe(true);
    expect(assistantCanAnswer({ ready: false, reason: "provider-signed-out" })).toBe(false);
    expect(assistantCanAnswer({ ready: false, reason: "no-provider" })).toBe(false);
  });
});

describe("replyFinishedSince", () => {
  const thread = (id: string, completedAt: string | null) => ({
    environmentId: server,
    id: ThreadId.make(id),
    latestRun: completedAt === null ? null : { completedAt },
  });

  it("counts a listed conversation's newly finished reply, once", () => {
    const before = finishedReplies([thread("a", "09:00"), thread("b", null)]);
    const running = finishedReplies([thread("a", "09:00"), thread("b", null)]);
    const done = finishedReplies([thread("a", "09:00"), thread("b", "09:05")]);
    expect(replyFinishedSince(before, running)).toBe(false);
    expect(replyFinishedSince(running, done)).toBe(true);
    expect(replyFinishedSince(done, done)).toBe(false);
  });

  it("leaves out a conversation listed for the first time with its past", () => {
    expect(replyFinishedSince(new Map(), finishedReplies([thread("a", "09:00")]))).toBe(false);
  });
});
