import { requireOptionalNativeModule } from "expo";

export interface SpeakOptions {
  /** A voice in `voice.bin`, counted from zero. */
  readonly voice: number;
  /** A language code the voice speaks, such as "fr". */
  readonly lang: string;
  readonly speed?: number;
}

export interface SpeechMeasurement {
  readonly loadMs: number;
  readonly firstAudioMs: number;
  readonly synthMs: number;
  readonly audioMs: number;
  readonly peakMemoryMb: number;
  /** The app's memory before the voice was loaded, so the voice's own share can be told. */
  readonly baselineMemoryMb: number;
}

interface MajordomeSpeech {
  isAvailable(): boolean;
  /** Loads the voice from a folder of the catalog's files. */
  load(
    directoryUri: string,
    options: { readonly threads?: number },
  ): Promise<{ readonly voices: number; readonly sampleRate: number }>;
  unload(): Promise<void>;
  /** Queues one sentence; returns the number its `sentenceStarted` event carries. */
  speak(text: string, options: SpeakOptions): number;
  /** Clears the queue and silences at once. */
  stop(): void;
  /** Reloads the voice and speaks `text` once, timing each step. */
  measure(text: string, options: SpeakOptions): Promise<SpeechMeasurement>;
  sha256(fileUri: string): Promise<string>;
  addListener(
    event: "sentenceStarted",
    listener: (event: { readonly id: number }) => void,
  ): { remove(): void };
  addListener(event: "drained", listener: () => void): { remove(): void };
  addListener(
    event: "error",
    listener: (event: { readonly message: string }) => void,
  ): { remove(): void };
}

const native = requireOptionalNativeModule<MajordomeSpeech>("MajordomeSpeech");

/** The on-device voice, on a build and a platform that carry it; null everywhere else. */
export const majordomeSpeech = native?.isAvailable() ? native : null;
