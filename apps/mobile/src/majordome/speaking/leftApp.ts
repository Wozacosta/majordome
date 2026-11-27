import { AppState, Platform } from "react-native";

/** How long Android's "background" must last before the app counts as left. */
export const ANDROID_PAUSE_GRACE_MS = 1_000;

/**
 * Tells a real exit from a pause the user comes straight back from. Feed it the app's states;
 * `onLeft` runs once the app has been in the background for `graceMs`, at once when that is 0.
 * Android calls any pause "background", a system dialog over the app included.
 */
export function createLeftAppWatcher(
  onLeft: () => void,
  graceMs: number,
  setTimer: (callback: () => void, ms: number) => () => void,
) {
  let cancel: (() => void) | null = null;
  const forget = () => {
    cancel?.();
    cancel = null;
  };
  return {
    state(state: string): void {
      if (state === "active") return forget();
      if (state !== "background" || cancel) return;
      if (graceMs <= 0) return onLeft();
      cancel = setTimer(() => {
        cancel = null;
        onLeft();
      }, graceMs);
    },
    stop: forget,
  };
}

/** Calls `onLeft` when the user leaves the app; returns its stop. */
export function watchLeftApp(onLeft: () => void): () => void {
  const watcher = createLeftAppWatcher(
    onLeft,
    Platform.OS === "android" ? ANDROID_PAUSE_GRACE_MS : 0,
    (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  );
  const subscription = AppState.addEventListener("change", (state) => watcher.state(state));
  return () => {
    watcher.stop();
    subscription.remove();
  };
}
