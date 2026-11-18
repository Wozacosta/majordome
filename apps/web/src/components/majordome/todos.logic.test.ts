import type { MajordomeTodoNote } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { todoDisplayText, todoKey, todosSummary, withoutTicked } from "./todos.logic";

const note = (path: string, texts: ReadonlyArray<string>, more = 0): MajordomeTodoNote => ({
  path,
  title: path,
  modifiedAt: "2026-11-15T09:00:00.000Z",
  todos: texts.map((text, index) => ({ line: index + 1, text })),
  more,
});

it("hides the to-dos ticked here, drops a note left empty and recounts", () => {
  const house = note("house.md", ["Call the plumber", "Measure the window"]);
  const trip = note("trip.md", ["Book the train"]);
  const long = note("long.md", ["First"], 3);
  const result = { notes: [house, trip, long], totalOpen: 9, totalNotes: 5 };

  expect(withoutTicked(result, new Set())).toEqual(result);

  const ticked = new Set([
    todoKey("house.md", house.todos[0]!),
    todoKey("trip.md", trip.todos[0]!),
    todoKey("long.md", long.todos[0]!),
    // The same words on the same line of another note are another to-do.
    todoKey("other.md", house.todos[1]!),
  ]);
  expect(withoutTicked(result, ticked)).toEqual({
    notes: [
      { ...house, todos: [house.todos[1]] },
      // Still listed: it has more to-dos than the list shows.
      { ...long, todos: [] },
    ],
    totalOpen: 6,
    totalNotes: 4,
  });
});

it("says how much there is to do", () => {
  expect(todosSummary(12, 4)).toBe("12 to do in 4 notes");
  expect(todosSummary(1, 1)).toBe("1 to do in 1 note");
});

it("shows a to-do's words without their Markdown marks", () => {
  expect(todoDisplayText("Ask Catarina if **Dec 30** night can be added")).toBe(
    "Ask Catarina if Dec 30 night can be added",
  );
  expect(todoDisplayText("Read [[projects/move|the move plan]] and [[Lease]]")).toBe(
    "Read the move plan and Lease",
  );
  expect(todoDisplayText("Pay [the bill](https://example.com/b) with `IBAN` _today_")).toBe(
    "Pay the bill with IBAN today",
  );
  expect(todoDisplayText("Compare 3 * 4 and snake_case_name, 5*6*7")).toBe(
    "Compare 3 * 4 and snake_case_name, 5*6*7",
  );
  expect(todoDisplayText("****")).toBe("****");
});
