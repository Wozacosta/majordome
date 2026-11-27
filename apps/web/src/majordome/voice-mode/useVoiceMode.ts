import { useSyncExternalStore } from "react";

import { voiceMode } from "./platform";
import type { VoiceModeRuntime, VoiceModeSnapshot } from "./voiceModeRuntime";

const noSubscription = () => () => {};
const IDLE: VoiceModeSnapshot = { chatKey: null, state: "idle", line: null };

/** Talking with the assistant in this window, or null where it is not offered. */
export function useVoiceMode(): VoiceModeRuntime | null {
  return useSyncExternalStore(voiceMode.subscribe, voiceMode.get, () => null);
}

export function useVoiceModeSnapshot(runtime: VoiceModeRuntime | null): VoiceModeSnapshot {
  return useSyncExternalStore(
    runtime?.subscribe ?? noSubscription,
    () => runtime?.getSnapshot() ?? IDLE,
    () => IDLE,
  );
}
