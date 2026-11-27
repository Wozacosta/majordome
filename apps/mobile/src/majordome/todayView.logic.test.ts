import { expect, it } from "vite-plus/test";

import { noteSections } from "./today.logic";
import {
  computerReach,
  dayFromToday,
  dayTitle,
  noteStatus,
  shiftDay,
  todaySetup,
  todoProgress,
} from "./todayView.logic";

it("moves a day across months, years and leap days", () => {
  expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
  expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  expect(shiftDay("2026-11-23", 0)).toBe("2026-11-23");
  expect(shiftDay("someday", 1)).toBe("someday");
});

it("says how far a day is from today, and nothing for today", () => {
  expect(dayFromToday("2026-11-23", "2026-11-23")).toBeNull();
  expect(dayFromToday("2026-11-22", "2026-11-23")).toBe("Yesterday");
  expect(dayFromToday("2026-11-24", "2026-11-23")).toBe("Tomorrow");
  expect(dayFromToday("2026-10-31", "2026-11-02")).toBe("2 days ago");
  expect(dayFromToday("2027-01-02", "2026-12-30")).toBe("In 3 days");
});

it("adds the year to a day's title only when it is another year", () => {
  expect(dayTitle("2026-11-22", "2026-11-23")).toBe("Sunday 22 November");
  expect(dayTitle("2025-12-31", "2026-01-01")).toBe("Wednesday 31 December 2025");
});

it("counts the ticked to-dos at every depth, and has no count for a note without any", () => {
  const note = ["## Do", "- [x] a", "  - [ ] b", "### Later", "1. [X] c", "- not one"].join("\n");
  expect(todoProgress(noteSections(note, "2026-11-23"))).toEqual({ done: 2, total: 3 });
  expect(todoProgress(noteSections("- just a line", "2026-11-23"))).toBeNull();
});

it("counts a computer as reachable only while connected or on its first try", () => {
  expect(computerReach("connected", false)).toBe("connected");
  expect(computerReach("connecting", false)).toBe("connecting");
  expect(computerReach("reconnecting", false)).toBe("unreachable");
  expect(computerReach("error", false)).toBe("unreachable");
  expect(computerReach(undefined, false)).toBe("unreachable");
  expect(computerReach("connected", true)).toBe("unreachable");
});

const SETUP = {
  storeLoaded: true,
  connections: "some",
  hasFolder: false,
  folderComputerKnown: false,
  anyConnected: true,
  anyConnecting: false,
  searching: false,
} as const;

it("names the one thing missing before a note can show", () => {
  expect(todaySetup({ ...SETUP, storeLoaded: false })).toBe("starting");
  expect(todaySetup({ ...SETUP, connections: "loading" })).toBe("starting");
  expect(todaySetup({ ...SETUP, connections: "none" })).toBe("noComputer");
  expect(todaySetup({ ...SETUP, searching: true })).toBe("looking");
  expect(todaySetup(SETUP)).toBe("noFolder");
  expect(todaySetup({ ...SETUP, anyConnected: false, anyConnecting: true })).toBe("looking");
  expect(todaySetup({ ...SETUP, anyConnected: false })).toBe("unreachable");
});

it("shows the folder this phone remembers until its computer is gone from the phone", () => {
  const remembered = { ...SETUP, hasFolder: true, folderComputerKnown: true, anyConnected: false };
  expect(todaySetup(remembered)).toBe("ready");
  expect(todaySetup({ ...remembered, connections: "loading", folderComputerKnown: false })).toBe(
    "ready",
  );
  expect(todaySetup({ ...remembered, connections: "none" })).toBe("noComputer");
  expect(todaySetup({ ...remembered, folderComputerKnown: false })).toBe("unreachable");
});

it("takes ticks only on a note the connected computer just gave", () => {
  const fresh = noteStatus({ reach: "connected", read: "answered", hasNote: true });
  expect(fresh).toEqual({ notice: null, canTick: true, empty: "nothing" });
  expect(noteStatus({ reach: "connected", read: "waiting", hasNote: true }).canTick).toBe(false);
  expect(noteStatus({ reach: "unreachable", read: "answered", hasNote: true })).toEqual({
    notice: "unreachable",
    canTick: false,
    empty: "nothing",
  });
});

it("says why a note is missing instead of waiting for ever", () => {
  const missing = { read: "waiting", hasNote: false } as const;
  expect(noteStatus({ ...missing, reach: "connected" }).empty).toBe("getting");
  expect(noteStatus({ ...missing, reach: "connecting" })).toMatchObject({
    notice: "connecting",
    empty: "later",
  });
  expect(noteStatus({ ...missing, reach: "unreachable" }).empty).toBe("later");
  expect(noteStatus({ reach: "connected", read: "failed", hasNote: false })).toMatchObject({
    notice: "failed",
    empty: null,
  });
  // A copy kept on the phone stays on screen while the read fails.
  expect(noteStatus({ reach: "connected", read: "failed", hasNote: true })).toMatchObject({
    notice: "failed",
    empty: "nothing",
  });
});
