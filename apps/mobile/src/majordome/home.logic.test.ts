import { expect, it } from "vite-plus/test";

import {
  answersFromHome,
  homeNeed,
  journalLine,
  listedOnHome,
  needsCardText,
  needsYouLabel,
  ONE_LINE_REQUEST,
  raiseNeedsYou,
} from "./home.logic";

it("names what a chat wants from the owner, and nothing while it works or is read", () => {
  expect(homeNeed("approval", false)).toBe("approval");
  expect(homeNeed("input", false)).toBe("answer");
  expect(homeNeed("request", true)).toBe("answer");
  expect(homeNeed("ready", true)).toBe("reply");
  expect(homeNeed("ready", false)).toBeNull();
  expect(homeNeed("working", true)).toBeNull();
  expect(homeNeed("failed", false)).toBeNull();
});

it("raises what needs the owner: an OK, then an answer, then a new reply, latest first", () => {
  const rows = [
    { id: "money", need: null, at: "2026-11-28T09:00:00Z" },
    { id: "old-reply", need: "reply", at: "2026-11-27T09:00:00Z" },
    { id: "meals", need: "answer", at: "2026-11-28T08:40:00Z" },
    { id: "new-reply", need: "reply", at: "2026-11-28T10:00:00Z" },
    { id: "home", need: null, at: null },
    { id: "trips", need: "approval", at: "2026-11-26T08:00:00Z" },
    { id: "late-ok", need: "approval", at: "2026-11-28T08:00:00Z" },
  ] as const;
  const raised = raiseNeedsYou(rows, (row) =>
    row.need === null ? null : { need: row.need, at: row.at },
  );
  expect(raised.items.map((row) => row.id)).toEqual([
    "late-ok",
    "trips",
    "meals",
    "new-reply",
    "old-reply",
    "money",
    "home",
  ]);
  expect(raised.count).toBe(5);
  expect(raised.restStart).toBe(5);
});

it("leaves the list as it is when nothing needs the owner", () => {
  const rows = ["a", "b", "c"];
  expect(raiseNeedsYou(rows, () => null)).toEqual({ items: rows, count: 0, restStart: 0 });
});

it("keeps rows with the same need and no date in the order they came", () => {
  const raised = raiseNeedsYou(["a", "b", "c"], () => ({ need: "reply", at: null }));
  expect(raised.items).toEqual(["a", "b", "c"]);
});

it("keeps a topic's other chats behind it wherever it goes, without counting them", () => {
  const rows = ["money", "money-side", "trips", "trips-side", "chat"];
  const raised = raiseNeedsYou(
    rows,
    // A chat shown under a topic is not raised on its own, even with a new reply.
    (row) => (row === "trips" || row === "money-side" ? { need: "reply", at: null } : null),
    (row) => (row.endsWith("-side") ? row.replace("-side", "") : undefined),
  );
  expect(raised.items).toEqual(["trips", "trips-side", "money", "money-side", "chat"]);
  expect(raised.count).toBe(1);
  expect(raised.restStart).toBe(2);
});

it("answers from home only a plain approval whose request is one short line", () => {
  const live = { responseCapability: "live" } as const;
  expect(answersFromHome(live)).toBe(true);
  expect(answersFromHome({ ...live, detail: "notes/trips/lyon.md" })).toBe(true);
  expect(answersFromHome({ ...live, detail: "a".repeat(ONE_LINE_REQUEST) })).toBe(true);
  expect(answersFromHome({ ...live, detail: "a".repeat(ONE_LINE_REQUEST + 1) })).toBe(false);
  expect(answersFromHome({ ...live, detail: "rm a\nrm b" })).toBe(false);
  expect(answersFromHome({ ...live, reason: "Outside your notes" })).toBe(false);
  expect(answersFromHome({ ...live, fullAccessOverride: "ask_rule" })).toBe(false);
  expect(answersFromHome({ ...live, options: [{ decision: "accept", label: "Yes" }] })).toBe(false);
  expect(answersFromHome({ ...live, options: [] })).toBe(true);
  expect(answersFromHome({ responseCapability: "not_resumable" })).toBe(false);
});

it("keeps what was typed as one journal line", () => {
  expect(journalLine("  buy bread \n and milk\n")).toBe("buy bread and milk");
  expect(journalLine(" \n ")).toBe("");
});

it("counts the chats that need the owner", () => {
  expect(needsYouLabel(2)).toBe("Needs you · 2");
});

it("leaves the Set-up chat out of home unless it waits for an OK or an answer", () => {
  expect(listedOnHome(true, null)).toBe(false);
  expect(listedOnHome(true, "reply")).toBe(false);
  expect(listedOnHome(true, homeNeed("approval", false))).toBe(true);
  expect(listedOnHome(true, homeNeed("input", false))).toBe(true);
  expect(listedOnHome(false, null)).toBe(true);
  expect(listedOnHome(false, "reply")).toBe(true);
});

it("draws a card only when it can say what is asked", () => {
  expect(
    needsCardText({
      need: "approval",
      preview: "old message",
      request: "Majordome wants to run a command on your computer. Allow?",
      detail: "  git status\ngit diff ",
    }),
  ).toEqual({
    words: "Majordome wants to run a command on your computer. Allow?",
    detail: "git status",
  });
  expect(
    needsCardText({ need: "answer", preview: null, request: "Which train, 9:40 or 11:10?" }),
  ).toEqual({ words: "Which train, 9:40 or 11:10?", detail: null });
  expect(
    needsCardText({ need: "reply", preview: "Lyon, 12–14 Dec · train booked", request: null }),
  ).toEqual({ words: "Lyon, 12–14 Dec · train booked", detail: null });
  // Nothing to read yet, or ever: an ordinary row.
  expect(needsCardText({ need: "approval", preview: "old message", request: null })).toBeNull();
  expect(needsCardText({ need: "answer", preview: null, request: "  " })).toBeNull();
  // A one-off chat carries no message text: "New reply" alone is a row, not a card.
  expect(needsCardText({ need: "reply", preview: null, request: "ignored" })).toBeNull();
});
