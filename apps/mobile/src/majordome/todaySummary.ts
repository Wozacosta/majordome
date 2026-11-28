import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { subscribeAppActive } from "../lib/appState";
import { appAtomRegistry } from "../state/atom-registry";
import { serverEnvironment } from "../state/server";
import { routineRows } from "./routine.logic";
import { majordomeEnvironment } from "./state";
import { localDate } from "./today.logic";
import { loadTodayStore, todayStoreAtom, updateTodayStore } from "./todayStore";
import { keepToday, todaySummary } from "./todaySummary.logic";

/** What the computer says now about a day, with the phone's copy of the store it came with. */
function readToday(get: Atom.AtomContext, date: string) {
  const store = get(todayStoreAtom);
  const vault = store?.vault ?? null;
  if (store === null || vault === null) return null;
  const note = get(
    majordomeEnvironment.dailyNote({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, date },
    }),
  );
  const tasks = get(
    serverEnvironment.scheduledTasksLive({ environmentId: vault.environmentId, input: {} }),
  );
  const listed = AsyncResult.getOrElse(tasks, () => null);
  return {
    store,
    note: note._tag === "Success" ? note.value.content : undefined,
    routines: listed === null ? undefined : routineRows(listed.tasks),
  };
}

// A string, so the page it is drawn on only hears of a change in the words themselves.
const todaySummaryAtom = Atom.family((date: string) =>
  Atom.make((get) => {
    const now = readToday(get, date);
    if (now === null) return null;
    const kept = now.store.note?.date === date ? now.store.note.content : undefined;
    return todaySummary({
      date,
      note: now.note === undefined ? kept : now.note,
      routines: now.routines ?? now.store.routines,
      hiddenRoutines: now.store.hiddenRoutines ?? [],
    });
  }).pipe(Atom.withLabel(`majordome:today-summary:${date}`)),
);

// As JSON, so it only changes when what the computer said does.
const todayFreshAtom = Atom.family((date: string) =>
  Atom.make((get) => {
    const now = readToday(get, date);
    return now === null ? null : JSON.stringify({ note: now.note, routines: now.routines });
  }).pipe(Atom.withLabel(`majordome:today-fresh:${date}`)),
);

/** Reads the phone's copy, and keeps today's note and the routines on it whenever the computer answers. */
export function useKeepToday(today: string): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the phone's file once and writes what the computer says back to it, both outside React
  useEffect(() => {
    void loadTodayStore();
    return appAtomRegistry.subscribe(
      todayFreshAtom(today),
      (fresh) => {
        if (fresh === null) return;
        const said = JSON.parse(fresh) as Parameters<typeof keepToday>[2];
        updateTodayStore((current) => keepToday(current, today, said));
      },
      { immediate: true },
    );
  }, [today]);
}

/**
 * The home page's line about today, from the computer or from the phone's copy when it cannot be
 * reached. Null while nothing is known or there is no notes folder.
 */
export function useTodaySummary(): string | null {
  const [today, setToday] = useState(() => localDate(new Date()));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the app coming back to the front is outside React: the day may have changed
  useEffect(() => subscribeAppActive(() => setToday(localDate(new Date()))), []);
  useKeepToday(today);
  return useAtomValue(todaySummaryAtom(today));
}
