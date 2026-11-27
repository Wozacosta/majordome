import { expect, it } from "vite-plus/test";

import { noteSendOnOpen, takeSendOnOpen } from "./sendOnOpen";

it("sends once, in the chat opened right after Today's box was sent", () => {
  expect(takeSendOnOpen(1_000)).toBe(false);
  noteSendOnOpen(1_000);
  expect(takeSendOnOpen(2_000)).toBe(true);
  expect(takeSendOnOpen(2_100)).toBe(false);
  // A chat opened long after is the owner's own: nothing is sent for them.
  noteSendOnOpen(1_000);
  expect(takeSendOnOpen(20_000)).toBe(false);
});
