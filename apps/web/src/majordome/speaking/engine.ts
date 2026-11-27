import type { ReadAloudEngine } from "@t3tools/client-runtime/speaking/read-aloud";
import type { VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";

import { createAudioPlayer, type AudioOutput } from "./audioPlayer";
import { MODEL_NAMES, type ModelName } from "./synthesis";
import type { SpeechWorkerEvent, SpeechWorkerRequest } from "./workerProtocol";

/**
 * How long the worker lives after it last spoke. It holds 1 to 1.7 GB while loaded, and loading
 * it again takes about two seconds; after Stop it goes sooner, but not at once, so asking another
 * reply to speak does not pay for a reload.
 */
const END_AFTER_REPLY_MS = 30_000;
const END_AFTER_STOP_MS = 5_000;

export interface SpeechWorkerPort {
  readonly post: (request: SpeechWorkerRequest) => void;
  readonly terminate: () => void;
}

export interface SpeechWorkerHandlers {
  readonly onEvent: (event: SpeechWorkerEvent) => void;
  /** The worker itself broke: its script did not load, or it ran out of memory. */
  readonly onError: (message: string) => void;
}

export type SpeechTiming =
  | { readonly event: "loaded"; readonly ms: number }
  | { readonly event: "first-sound"; readonly ms: number }
  | {
      readonly event: "sentence";
      readonly synthMs: number;
      readonly audioSeconds: number;
      readonly lang: string;
    }
  | { readonly event: "ended" };

export interface SpeechEngine extends ReadAloudEngine {
  /** Fires when the first sentence of a reply starts to sound, and when the reply ends. */
  readonly onSounding: (listener: (sounding: boolean) => void) => () => void;
  /** Ends the worker now and frees what it holds. */
  readonly end: () => void;
}

export function modelFiles(catalog: VoiceCatalog): Record<ModelName, string> {
  const files = {} as Record<ModelName, string>;
  for (const model of MODEL_NAMES) {
    const file = catalog.files.find(
      ({ name }) => name.startsWith(`${model}.`) && name.endsWith(".onnx"),
    );
    if (!file) throw new Error(`The voice has no ${model} file.`);
    files[model] = file.name;
  }
  return files;
}

export function createSpeechEngine(options: {
  readonly catalog: VoiceCatalog;
  readonly audio: () => AudioOutput;
  readonly createWorker: (handlers: SpeechWorkerHandlers) => SpeechWorkerPort;
  readonly onTiming?: (timing: SpeechTiming) => void;
  readonly now?: () => number;
}): SpeechEngine {
  const now = options.now ?? (() => performance.now());
  const drained = new Set<() => void>();
  const failed = new Set<(message: string) => void>();
  const sounding = new Set<(sounding: boolean) => void>();
  const emit = <A>(listeners: Set<(value: A) => void>, value: A) => {
    for (const listener of listeners) listener(value);
  };

  let worker: SpeechWorkerPort | null = null;
  let loaded: PromiseWithResolvers<void> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let turn = 0;
  let nextId = 0;
  /** Sentences sent to the worker whose sound has not come back yet, by id. */
  const waiting = new Map<number, string>();
  let askedAt: number | null = null;
  let isSounding = false;

  const setSounding = (value: boolean) => {
    if (isSounding === value) return;
    isSounding = value;
    emit(sounding, value);
  };
  const finish = () => {
    setSounding(false);
    endLater(END_AFTER_REPLY_MS);
    for (const listener of drained) listener();
  };
  const player = createAudioPlayer(options.audio, () => {
    if (waiting.size === 0) finish();
  });

  const end = () => {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
    worker?.terminate();
    if (worker) options.onTiming?.({ event: "ended" });
    worker = null;
    loaded?.reject(new Error("The voice was unloaded."));
    loaded = null;
  };
  function endLater(ms: number) {
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(end, ms);
  }
  const fail = (message: string) => {
    waiting.clear();
    player.stop();
    setSounding(false);
    end();
    emit(failed, message);
  };

  const receive = (event: SpeechWorkerEvent) => {
    if (event.type === "loaded") {
      options.onTiming?.({ event: "loaded", ms: event.loadMs });
      loaded?.resolve();
      return;
    }
    if (event.type === "load-failed") {
      const loading = loaded;
      loaded = null;
      end();
      loading?.reject(new Error(event.message));
      return;
    }
    if (event.turn !== turn) return;
    if (event.type === "failed") return fail(event.message);
    const lang = waiting.get(event.id) ?? "";
    waiting.delete(event.id);
    if (askedAt !== null) {
      options.onTiming?.({ event: "first-sound", ms: Math.round(now() - askedAt) });
      askedAt = null;
    }
    options.onTiming?.({
      event: "sentence",
      synthMs: event.synthMs,
      audioSeconds: Math.round((event.samples.length / event.sampleRate) * 100) / 100,
      lang,
    });
    if (event.samples.length === 0) {
      if (waiting.size === 0 && !player.busy) finish();
      return;
    }
    // The buffer was transferred from the worker, so it is this side's own.
    player.play(event.samples as Float32Array<ArrayBuffer>, event.sampleRate);
    setSounding(true);
  };

  return {
    prepare: () => {
      if (endTimer) clearTimeout(endTimer);
      endTimer = null;
      if (loaded) return loaded.promise;
      const loading = Promise.withResolvers<void>();
      // A reply stopped while the voice loads leaves no one to hear the refusal.
      loading.promise.catch(() => {});
      loaded = loading;
      try {
        worker = options.createWorker({
          onEvent: receive,
          onError: (text) => {
            if (loaded === loading) {
              loaded = null;
              end();
              loading.reject(new Error(text));
            } else fail(text);
          },
        });
        worker.post({
          type: "load",
          catalogId: options.catalog.id,
          models: modelFiles(options.catalog),
        });
      } catch (error) {
        loaded = null;
        end();
        loading.reject(error);
      }
      return loading.promise;
    },
    speak: (text, { voice, lang }) => {
      if (!worker) return;
      if (endTimer) clearTimeout(endTimer);
      endTimer = null;
      if (waiting.size === 0 && !player.busy) askedAt = now();
      nextId += 1;
      waiting.set(nextId, lang);
      worker.post({ type: "speak", turn, id: nextId, text, voice, lang });
    },
    stop: () => {
      turn += 1;
      waiting.clear();
      askedAt = null;
      player.stop();
      setSounding(false);
      if (!worker) return;
      worker.post({ type: "cancel", turn });
      endLater(END_AFTER_STOP_MS);
    },
    onDrained: (listener) => {
      drained.add(listener);
      return () => drained.delete(listener);
    },
    onError: (listener) => {
      failed.add(listener);
      return () => failed.delete(listener);
    },
    onSounding: (listener) => {
      sounding.add(listener);
      return () => sounding.delete(listener);
    },
    end,
  };
}
