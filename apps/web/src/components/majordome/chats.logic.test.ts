import { expect, it } from "vite-plus/test";

import { splitChats } from "./chats.logic";

const chat = (title: string, at: string | null, done = false) => ({ title, at, done });
const split = (query: string, chats: ReadonlyArray<ReturnType<typeof chat>>) => {
  const { current, earlier } = splitChats(chats, {
    query,
    isDone: (thread) => thread.done,
    activityOf: (thread) => thread.at,
  });
  return [current.map((row) => row.thread.title), earlier.map((row) => row.thread.title)];
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
