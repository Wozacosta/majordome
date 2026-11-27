import { splitSentences, toSpeakableText } from "@t3tools/client-runtime/speaking";
import {
  ReadAloudController,
  type ReadAloudRequest,
} from "@t3tools/client-runtime/speaking/read-aloud";
import { pickSpeechLanguage } from "@t3tools/client-runtime/speaking/language";
import type { VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { createVoiceStore, type VoiceFiles } from "@t3tools/client-runtime/speaking/voice-store";

import type { SpeakOptions, SpeechMeasurement } from "../../native/majordomeSpeech";

/** The native voice, as much of it as reading aloud needs. */
export interface SpeechPort {
  load(directoryUri: string, options: object): Promise<{ readonly voices: number }>;
  unload(): Promise<void>;
  speak(text: string, options: SpeakOptions): number;
  stop(): void;
  measure(text: string, options: SpeakOptions): Promise<SpeechMeasurement>;
  addListener(event: "drained", listener: () => void): { remove(): void };
  addListener(
    event: "error",
    listener: (event: { readonly message: string }) => void,
  ): { remove(): void };
}

export interface ReadAloudPlatform {
  readonly speech: SpeechPort;
  readonly catalog: VoiceCatalog;
  readonly files: VoiceFiles;
  readonly directoryUri: string;
  readonly takeAudio: (onTaken: () => void) => Promise<(() => void) | null>;
  readonly settle: () => Promise<void>;
  /** Shows the sheet that offers the download. */
  readonly openDownload: () => void;
  readonly reportError: () => void;
  /** What is said in place of a code block, a table and a bare link, in the app's language. */
  readonly placeholders: () => {
    readonly codeLine: string;
    readonly tableLine: string;
    readonly linkWord: string;
  };
  readonly appLanguage: () => string;
  readonly readVoice: () => number;
  readonly writeVoice: (voice: number) => void;
}

/** How long the voice stays in memory after it last spoke: it holds about 300 MB. */
const UNLOAD_AFTER_MS = 120_000;

export function createReadAloudRuntime(platform: ReadAloudPlatform) {
  const { speech } = platform;
  const store = createVoiceStore(platform.catalog, platform.files);
  let loaded: Promise<{ readonly voices: number }> | null = null;
  let unloadTimer: ReturnType<typeof setTimeout> | null = null;
  let voice = platform.readVoice();
  let pending: ReadAloudRequest | null = null;
  const voiceListeners = new Set<() => void>();

  const load = () => {
    loaded ??= speech.load(platform.directoryUri, {}).catch((error: unknown) => {
      loaded = null;
      throw error;
    });
    return loaded;
  };
  const unload = () => {
    if (unloadTimer) clearTimeout(unloadTimer);
    unloadTimer = null;
    if (!loaded) return Promise.resolve();
    loaded = null;
    return speech.unload().catch(() => {});
  };

  const controller = new ReadAloudController({
    engine: {
      prepare: async () => void (await load()),
      speak: (text, options) => void speech.speak(text, options),
      stop: () => speech.stop(),
      onDrained: (listener) => {
        const subscription = speech.addListener("drained", listener);
        return () => subscription.remove();
      },
      onError: (listener) => {
        const subscription = speech.addListener("error", (event) => listener(event.message));
        return () => subscription.remove();
      },
    },
    voiceReady: async () => (await store.refresh()).status === "ready",
    offerDownload: (request) => {
      pending = request;
      platform.openDownload();
    },
    takeAudio: platform.takeAudio,
    sentences: (markdown) => splitSentences(toSpeakableText(markdown, platform.placeholders())),
    language: (text) =>
      pickSpeechLanguage(text, platform.appLanguage(), platform.catalog.languages),
    voice: () => voice,
    settle: platform.settle,
    onError: platform.reportError,
  });

  controller.subscribe(() => {
    if (unloadTimer) clearTimeout(unloadTimer);
    unloadTimer =
      controller.getState().status === "idle"
        ? setTimeout(() => void unload(), UNLOAD_AFTER_MS)
        : null;
  });

  return {
    store,
    controller,
    /** Downloads the voice, then reads the reply that asked for it. */
    download: async () => {
      const state = await store.download();
      const request = pending;
      // A failed download can be tried again from the same sheet, for the same reply.
      if (state.status !== "failed") pending = null;
      if (state.status === "ready" && request) void controller.start(request);
      return state;
    },
    /** The sheet closed: forgets the waiting reply, unless its download is what closed it. */
    dismissDownload: () => {
      const { status } = store.getState();
      if (status !== "downloading" && status !== "ready") pending = null;
    },
    remove: async () => {
      controller.stop();
      await unload();
      await store.remove();
    },
    /** Stops speaking and frees the voice's memory, for when the app leaves the screen. */
    suspend: () => {
      controller.stop();
      return unload();
    },
    voiceCount: async () => (await load()).voices,
    getVoice: () => voice,
    setVoice: (next: number) => {
      voice = next;
      platform.writeVoice(next);
      for (const listener of voiceListeners) listener();
    },
    subscribeVoice: (listener: () => void) => {
      voiceListeners.add(listener);
      return () => voiceListeners.delete(listener);
    },
    measure: async (text: string, lang: string) => {
      controller.stop();
      const release = await platform.takeAudio(() => speech.stop());
      try {
        await load();
        return await speech.measure(text, { voice, lang });
      } finally {
        // The sentence is still playing; the session is given back once it has.
        setTimeout(() => release?.(), 8_000);
      }
    },
  };
}

export type ReadAloudRuntime = ReturnType<typeof createReadAloudRuntime>;
