import { expect, it } from "vite-plus/test";

import type { RoutineRow } from "./routine.logic";
import { EMPTY_TODAY_STORE } from "./today.logic";
import { keepToday, todaySummary } from "./todaySummary.logic";

const at = (hour: number, minute = 0, day = 28) =>
  new Date(2026, 10, day, hour, minute).toISOString();

const routine = (over: Partial<RoutineRow> & { readonly title: string }): RoutineRow => ({
  id: over.title,
  threadId: null,
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  ...over,
});

const NOTE = "## To do\n- [ ] Call the notary\n- [ ] Book the train\n- [x] Pay the plumber\n";
const brief = routine({ title: "Morning brief", lastRunAt: at(8), lastRunStatus: "succeeded" });
const review = routine({ title: "Review my week", nextRunAt: at(18) });

it("says the to-dos left, then the routine that last ran today", () => {
  expect(
    todaySummary({
      date: "2026-11-28",
      note: NOTE,
      routines: [brief, review],
      hiddenRoutines: [],
    }),
  ).toBe("2 to do · Morning brief done");
});

it("says the next routine due today when none has run", () => {
  expect(
    todaySummary({ date: "2026-11-28", note: NOTE, routines: [review], hiddenRoutines: [] }),
  ).toBe("2 to do · Review my week at 18:00");
});

it("leaves hidden routines out and says when every to-do is done", () => {
  expect(
    todaySummary({
      date: "2026-11-28",
      note: "- [x] Pay the plumber",
      routines: [brief],
      hiddenRoutines: ["Morning brief"],
    }),
  ).toBe("All done");
});

it("says nothing while neither the note nor the routines are known", () => {
  expect(
    todaySummary({ date: "2026-11-28", note: undefined, routines: undefined, hiddenRoutines: [] }),
  ).toBeNull();
  // Routines alone are known, with none worth a word: still nothing to say.
  expect(
    todaySummary({ date: "2026-11-28", note: undefined, routines: [], hiddenRoutines: [] }),
  ).toBeNull();
});

it("works from one of the two when the other is not known", () => {
  expect(
    todaySummary({ date: "2026-11-28", note: undefined, routines: [brief], hiddenRoutines: [] }),
  ).toBe("Morning brief done");
  expect(
    todaySummary({ date: "2026-11-28", note: NOTE, routines: undefined, hiddenRoutines: [] }),
  ).toBe("2 to do");
});

it("says there is nothing to do on a day with no to-dos and no routine", () => {
  expect(todaySummary({ date: "2026-11-28", note: null, routines: [], hiddenRoutines: [] })).toBe(
    "Nothing to do",
  );
  expect(
    todaySummary({
      date: "2026-11-28",
      note: "- 09:12 Slept badly",
      routines: [],
      hiddenRoutines: [],
    }),
  ).toBe("Nothing to do");
});

it("keeps what the computer said about today, and the same store when nothing changed", () => {
  const kept = keepToday(EMPTY_TODAY_STORE, "2026-11-28", { note: NOTE, routines: [brief] });
  expect(kept.note).toEqual({ date: "2026-11-28", content: NOTE });
  expect(kept.routines).toEqual([brief]);
  expect(keepToday(kept, "2026-11-28", { note: NOTE, routines: [{ ...brief }] })).toBe(kept);
  // No answer about the note leaves the kept one alone; a new day replaces it.
  expect(keepToday(kept, "2026-11-28", {})).toBe(kept);
  expect(keepToday(kept, "2026-11-29", { note: null }).note).toEqual({
    date: "2026-11-29",
    content: null,
  });
});
