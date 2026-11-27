import { expect, it } from "vite-plus/test";

import { noteTalkShortcut, takeTalkIntent } from "./newChatIntent";

const TALK = "/new?voice=1";

it("starts voice mode once, in the new chat the Talk shortcut opened", () => {
  noteTalkShortcut(TALK, TALK, 1_000);
  expect(takeTalkIntent(2_000)).toBe(true);
  expect(takeTalkIntent(2_100)).toBe(false);
});

it("does not start it for another shortcut, or for a new chat opened much later", () => {
  noteTalkShortcut("/new", TALK, 1_000);
  expect(takeTalkIntent(1_100)).toBe(false);
  noteTalkShortcut(TALK, TALK, 1_000);
  expect(takeTalkIntent(20_000)).toBe(false);
});
