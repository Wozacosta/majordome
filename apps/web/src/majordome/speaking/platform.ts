import { isMajordome } from "~/env";

import type { SpeakingSeam } from "./createRuntime";
import type { ReadAloudRuntime } from "./runtime";
import { browserVoiceSupportProbe, detectVoiceSupport } from "./support";

let runtime: ReadAloudRuntime | null = null;
const listeners = new Set<() => void>();

async function start() {
  if (!isMajordome || typeof window === "undefined") return;
  const seam = (window as { __majordomeSpeaking?: SpeakingSeam }).__majordomeSpeaking;
  const support = seam?.support ?? (await detectVoiceSupport(browserVoiceSupportProbe()));
  if (!support) return;
  // Everything past the button loads apart from the app's first script.
  const { createRuntime } = await import("./createRuntime");
  runtime = createRuntime(support, seam);
  for (const listener of listeners) listener();
}
void start();

/** Read aloud in this window; null where the graphics card cannot run the voice. */
export const readAloud = {
  get: (): ReadAloudRuntime | null => runtime,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
