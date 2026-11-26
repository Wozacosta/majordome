import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { writeFileAtomically } from "../lib/atomic-file";
import { appAtomRegistry } from "../state/atom-registry";
import {
  EMPTY_TODAY_STORE,
  forgetRemovedComputers,
  type NoteCapture,
  type TodayStore,
} from "./today.logic";

const FILE_NAME = "majordome-today.json";

/** Null until the phone's copy has been read; nothing is written before that. */
export const todayStoreAtom = Atom.make<TodayStore | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("majordome:today-store"),
);

async function storeFile() {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, FILE_NAME);
}

let loading: Promise<void> | null = null;

export function loadTodayStore(): Promise<void> {
  loading ??= (async () => {
    let stored = EMPTY_TODAY_STORE;
    try {
      const file = await storeFile();
      if (file.exists)
        stored = { ...EMPTY_TODAY_STORE, ...(JSON.parse(await file.text()) as TodayStore) };
    } catch {
      // An unreadable copy is the same as none: the server still has the note.
    }
    appAtomRegistry.set(todayStoreAtom, stored);
    appAtomRegistry.subscribe(
      environmentCatalog.catalogValueAtom,
      (catalog) => {
        // Not before the saved computers are read: until then every computer looks removed.
        if (!catalog.isReady) return;
        updateTodayStore((current) =>
          forgetRemovedComputers(current, (environmentId) => catalog.entries.has(environmentId)),
        );
      },
      { immediate: true },
    );
  })();
  return loading;
}

let writing: Promise<void> = Promise.resolve();

export function updateTodayStore(update: (store: TodayStore) => TodayStore): void {
  const current = appAtomRegistry.get(todayStoreAtom);
  if (current === null) return;
  const next = update(current);
  if (next === current) return;
  appAtomRegistry.set(todayStoreAtom, next);
  writing = writing
    .then(async () => writeFileAtomically(await storeFile(), JSON.stringify(next)))
    .catch(() => undefined);
}

let sending = false;

/** Sends the waiting lines oldest first and stops at the first one the server does not take. */
export async function sendWaiting(send: (capture: NoteCapture) => Promise<boolean>): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (;;) {
      const next = appAtomRegistry.get(todayStoreAtom)?.captures[0];
      if (next === undefined || !(await send(next))) return;
      updateTodayStore((current) => ({
        ...current,
        captures: current.captures.filter((capture) => capture.id !== next.id),
      }));
    }
  } finally {
    sending = false;
  }
}
