import { webVoiceCatalog, type VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";

import { onDictationStarted } from "./dictationBus";
import { playCue } from "./cues";
import { createSpeechEngine, type SpeechEngine, type SpeechTiming } from "./engine";
import { createOpfsVoiceFiles } from "./opfsVoiceFiles";
import { createReadAloudRuntime, type ReadAloudRuntime } from "./runtime";
import { readAloudAppLanguage } from "./appLanguage";
import type { VoiceSupport } from "./support";
import { MAX_VOICES, voiceCount } from "./synthesis";
import { removeVoiceFolders, voiceFolder } from "./voiceFolder";
import type { SpeechWorkerEvent } from "./workerProtocol";

/**
 * What a scenario puts on `window.__majordomeSpeaking` before the app loads, to drive Read
 * aloud without a graphics card or a 220 MB download.
 */
export interface SpeakingSeam {
  readonly support?: VoiceSupport;
  readonly catalog?: VoiceCatalog;
  readonly engine?: SpeechEngine;
}

const VOICE_KEY = "majordome:read-aloud-voice";
/** In a development build only: another host for the voice files, in place of majord.link/voice. */
const DEV_ORIGIN_KEY = "majordome:voice-origin";

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

function recordTiming(timing: SpeechTiming) {
  if (!import.meta.env.DEV) return;
  const scope = globalThis as { __majordomeSpeakingLog?: Array<SpeechTiming & { at: number }> };
  (scope.__majordomeSpeakingLog ??= []).push({ ...timing, at: Math.round(performance.now()) });
}

export function createRuntime(
  support: VoiceSupport,
  seam: SpeakingSeam | undefined,
): ReadAloudRuntime {
  const origin = import.meta.env.DEV ? stored(DEV_ORIGIN_KEY) : null;
  const catalog = seam?.catalog ?? webVoiceCatalog(support.halfFloats, ...(origin ? [origin] : []));
  let context: AudioContext | null = null;
  const audio = () => (context ??= new AudioContext({ latencyHint: "playback" }));
  return createReadAloudRuntime({
    catalog,
    files: createOpfsVoiceFiles(() => voiceFolder(catalog.id)),
    engine:
      seam?.engine ??
      createSpeechEngine({
        catalog,
        audio,
        onTiming: recordTiming,
        createWorker: ({ onEvent, onError }) => {
          const worker = new Worker(new URL("./speech.worker.ts", import.meta.url), {
            type: "module",
            name: "majordome-speech",
          });
          worker.addEventListener("message", (event: MessageEvent<SpeechWorkerEvent>) =>
            onEvent(event.data),
          );
          worker.addEventListener("error", (event) => onError(event.message));
          return {
            post: (request) => worker.postMessage(request),
            terminate: () => worker.terminate(),
          };
        },
      }),
    wakeAudio: () => void audio().resume(),
    restAudio: () => void context?.suspend(),
    cue: (kind) => playCue(audio(), kind),
    onDictationStarted,
    voiceCount: async () => {
      const file = await (
        await (await voiceFolder(catalog.id)).getFileHandle("voice.bin")
      ).getFile();
      return voiceCount(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    },
    removeLeftovers: removeVoiceFolders,
    reportError: () =>
      toastManager.add({
        type: "error",
        title: m(msg("Could not read this aloud")),
        description: m(msg("Try again.")),
      }),
    placeholders: () => ({
      codeLine: m(msg("There is code on screen.")),
      tableLine: m(msg("There is a table on screen.")),
      linkWord: m(msg("a link", { $context: "said aloud in place of a web address" })),
    }),
    appLanguage: readAloudAppLanguage,
    readVoice: () => {
      const voice = Number.parseInt(stored(VOICE_KEY) ?? "", 10);
      return Number.isInteger(voice) && voice >= 0 && voice < MAX_VOICES ? voice : 0;
    },
    writeVoice: (voice) => {
      try {
        localStorage.setItem(VOICE_KEY, String(voice));
      } catch {}
    },
  });
}
