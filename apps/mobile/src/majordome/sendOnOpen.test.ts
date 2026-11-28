import { expect, it } from "vite-plus/test";

import { noteSendOnOpen, noteWriteOnOpen, takeSendOnOpen, takeWriteOnOpen } from "./sendOnOpen";

it("sends once, in the chat opened right after Today's box was sent", () => {
  expect(takeSendOnOpen(1_000)).toBe(false);
  noteSendOnOpen(1_000);
  expect(takeSendOnOpen(2_000)).toBe(true);
  expect(takeSendOnOpen(2_100)).toBe(false);
  // A chat opened long after is the owner's own: nothing is sent for them.
  noteSendOnOpen(1_000);
  expect(takeSendOnOpen(20_000)).toBe(false);
});

it("never sends a chat opened for a photo: it waits for the owner's words", () => {
  noteWriteOnOpen(1_000);
  expect(takeSendOnOpen(1_500)).toBe(false);
  expect(takeWriteOnOpen(2_000)).toBe(true);
  expect(takeWriteOnOpen(2_100)).toBe(false);
  // Sending from the box right after replaces it.
  noteWriteOnOpen(3_000);
  noteSendOnOpen(3_500);
  expect(takeWriteOnOpen(3_600)).toBe(false);
  expect(takeSendOnOpen(3_700)).toBe(true);
});
