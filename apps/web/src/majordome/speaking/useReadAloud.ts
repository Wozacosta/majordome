import { useSyncExternalStore } from "react";

import { readAloud } from "./platform";
import type { ReadAloudRuntime } from "./runtime";

/** Read aloud in this window, or null where it is not offered. */
export function useReadAloud(): ReadAloudRuntime | null {
  return useSyncExternalStore(readAloud.subscribe, readAloud.get, () => null);
}
