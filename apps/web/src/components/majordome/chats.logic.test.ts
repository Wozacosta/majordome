import { expect, it } from "vite-plus/test";

import { resolveThreadStatusPill } from "../Sidebar.logic";
import { chatStatusWords, chatTitle, renamedChatTitle, splitChats } from "./chats.logic";

const chat = (title: string, at: string | null, done = false) => ({ title, at, done });
const split = (query: string, chats: ReadonlyArray<ReturnType<typeof chat>>) => {
  const { current, done } = splitChats(chats, {
    query,
    isDone: (thread) => thread.done,
    activityOf: (thread) => thread.at,
  });
  return [current.map((row) => row.thread.title), done.map((row) => row.thread.title)];
};

it("lists the chats still going newest first, and the done ones apart", () => {
  const chats = [
    chat("Old", "2026-11-01T10:00:00Z"),
    chat("Done", "2026-11-20T10:00:00Z", true),
    chat("New", "2026-11-21T10:00:00Z"),
    chat("Never used", null),
  ];
  expect(split("", chats)).toEqual([["New", "Old", "Never used"], ["Done"]]);
});

it("keeps only the chats whose title has what was typed, whatever its case", () => {
  const chats = [chat("Mailing address", "2026-11-21T10:00:00Z"), chat("Run", null, true)];
  expect(split("  MAIL ", chats)).toEqual([["Mailing address"], []]);
  expect(split("zzz", chats)).toEqual([[], []]);
});

it("finds a chat not named yet by the title it is shown with", () => {
  expect(chatTitle("New thread")).toBe("New chat");
  expect(chatTitle("Taxes")).toBe("Taxes");
  expect(split("new chat", [chat("New thread", null)])).toEqual([["New thread"], []]);
});

it("says in plain words what a chat is waiting for", () => {
  const thread = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    interactionMode: "default" as const,
    latestRun: null,
    runtime: null,
  };
  const words = (changes: Partial<typeof thread>) =>
    chatStatusWords(resolveThreadStatusPill({ thread: { ...thread, ...changes } })?.label ?? "");
  expect(words({ hasPendingApprovals: true })).toBe("Needs your OK");
  expect(words({ hasPendingUserInput: true })).toBe("Waiting for your answer");
  expect(chatStatusWords("Working")).toBe("Working");
});

it("saves a rename only when the title really changes", () => {
  expect(renamedChatTitle("  Taxes 2026 ", "Taxes")).toBe("Taxes 2026");
  expect(renamedChatTitle("Taxes", "Taxes")).toBeNull();
  expect(renamedChatTitle("   ", "Taxes")).toBeNull();
  expect(renamedChatTitle("New chat", "New thread")).toBeNull();
});
