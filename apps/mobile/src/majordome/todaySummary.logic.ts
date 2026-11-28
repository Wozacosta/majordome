import { routineHeadline, type RoutineRow } from "./routine.logic";
import { noteSections, type TodayStore } from "./today.logic";
import { todoProgress } from "./todayView.logic";

/**
 * The few words the home page says about today: the to-dos left, then the routine that last ran
 * or runs next ("2 to do · Morning brief done"). Null while neither the note nor the routines
 * are known.
 */
export function todaySummary(input: {
  readonly date: string;
  /** Today's note; null when none is written yet, undefined while it is not known. */
  readonly note: string | null | undefined;
  /** Undefined while they are not known. */
  readonly routines: ReadonlyArray<RoutineRow> | undefined;
  readonly hiddenRoutines: ReadonlyArray<string>;
}): string | null {
  if (input.note === undefined && input.routines === undefined) return null;
  const progress =
    input.note === undefined || input.note === null
      ? null
      : todoProgress(noteSections(input.note, input.date));
  const left = progress === null ? 0 : progress.total - progress.done;
  const todos = progress === null ? null : left === 0 ? "All done" : `${left} to do`;
  const routine = routineHeadline(input.routines ?? [], input.date, input.hiddenRoutines);
  const parts = [todos, routine].filter((part) => part !== null);
  if (parts.length > 0) return parts.join(" · ");
  return input.note === undefined ? null : "Nothing to do";
}

/** The store with what the computer just said about today, so it shows with no connection. */
export function keepToday(
  store: TodayStore,
  date: string,
  fresh: {
    readonly note?: string | null;
    readonly routines?: ReadonlyArray<RoutineRow>;
  },
): TodayStore {
  let next = store;
  if (
    fresh.note !== undefined &&
    !(store.note?.date === date && store.note.content === fresh.note)
  ) {
    next = { ...next, note: { date, content: fresh.note } };
  }
  if (
    fresh.routines !== undefined &&
    JSON.stringify(store.routines ?? null) !== JSON.stringify(fresh.routines)
  ) {
    next = { ...next, routines: fresh.routines };
  }
  return next;
}
