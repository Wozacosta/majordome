import {
  createEndOfTurnDetector,
  type ConversationHeard,
  type EndOfTurnOptions,
} from "@t3tools/client-runtime/speaking";
import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

/** The recorder dictation uses, as much of it as a conversation needs. */
export interface EarsRecorder {
  readonly uri: string | null;
  prepareToRecordAsync(signal?: AbortSignal): Promise<void>;
  record(options: { readonly forDuration: number }): void;
  stop(): Promise<void>;
  /** The live level in dBFS, or null when it is not capturing. */
  level(): number | undefined | null;
}

export interface ConversationEarsDeps {
  readonly recorder: EarsRecorder;
  /** Wherever the user's voice input is set to transcribe; null when nowhere can. */
  readonly getTranscriber: () => VoiceTranscriber | null;
  readonly deleteRecording: (uri: string) => void;
  readonly now: () => number;
  /** Calls `tick` at the metering pace until the returned function is called. */
  readonly every: (tick: () => void) => () => void;
  readonly endOfTurn?: EndOfTurnOptions;
  /** The longest one turn may be, in seconds; what was said by then is sent. */
  readonly longestTurnSeconds?: number;
}

export interface ConversationEars {
  listen(signal: AbortSignal): Promise<ConversationHeard>;
  /** The user tapped Send: what was recorded so far is the turn. */
  sendNow(): void;
  /** The recorder reached its limit or failed; `failed` carries why. */
  recorderStopped(failed?: string | null): void;
}

const DEFAULT_GIVE_UP_MS = 30_000;
const DEFAULT_LONGEST_TURN_SECONDS = 180;

/**
 * Hears one turn of a conversation: records until the speaker stops, or Send is tapped, then
 * transcribes where the user's voice input is set to. Unlike dictation it returns the words
 * instead of writing them into a draft.
 */
export function createConversationEars(deps: ConversationEarsDeps): ConversationEars {
  const giveUpMs = deps.endOfTurn?.giveUpMs ?? DEFAULT_GIVE_UP_MS;
  let finishCurrent: ((failed?: string | null) => void) | null = null;
  // An empty transcript listens again without restarting the wait for a first word: this is
  // how long the listening before it went on with nothing heard.
  let quietMs = 0;

  return {
    async listen(signal) {
      const transcriber = deps.getTranscriber();
      if (!transcriber) throw new Error("Voice transcription is not available.");
      const startedAtMs = deps.now();
      const quietBeforeMs = quietMs;
      quietMs = 0;
      const detector = createEndOfTurnDetector({
        ...deps.endOfTurn,
        giveUpMs: Math.max(0, giveUpMs - quietBeforeMs),
      });

      const transcription = await transcriber.prepare({ signal });
      await deps.recorder.prepareToRecordAsync(signal);
      const startUri = deps.recorder.uri;
      const live =
        transcription.start && startUri
          ? transcription.start(startUri, { signal }).then(
              (text) => ({ text }),
              (error: unknown) => ({ error }),
            )
          : null;

      const outcome = await new Promise<"ended" | "gave-up" | { readonly failed: string }>(
        (resolve) => {
          let stopTicking: (() => void) | null = null;
          const settle = (result: "ended" | "gave-up" | { readonly failed: string }) => {
            if (finishCurrent === null) return;
            finishCurrent = null;
            stopTicking?.();
            signal.removeEventListener("abort", onAbort);
            resolve(result);
          };
          const onAbort = () => settle("ended");
          finishCurrent = (failed) => settle(failed ? { failed } : "ended");
          if (signal.aborted) return settle("ended");
          signal.addEventListener("abort", onAbort, { once: true });
          deps.recorder.record({
            forDuration: deps.longestTurnSeconds ?? DEFAULT_LONGEST_TURN_SECONDS,
          });
          stopTicking = deps.every(() => {
            const db = deps.recorder.level();
            if (db === null) return;
            const status = detector.push({ db: db ?? Number.NaN, atMs: deps.now() });
            if (status === "ended" || status === "gave-up") settle(status);
          });
        },
      );

      await deps.recorder.stop().catch(() => {});
      const uri = deps.recorder.uri ?? startUri;
      const discard = () => {
        if (!uri) return;
        try {
          deps.deleteRecording(uri);
        } catch {}
      };
      try {
        if (signal.aborted) throw signal.reason ?? new Error("Listening was stopped.");
        if (typeof outcome === "object") throw new Error(outcome.failed);
        if (outcome === "gave-up") return { gaveUp: true };
        const started = live ? await live : null;
        if (started && "error" in started) throw started.error;
        const text = (
          started?.text ??
          (transcription.streaming
            ? await transcription.streaming.finish({ signal })
            : uri
              ? await transcription.transcribe(uri, { signal })
              : "")
        ).trim();
        if (text === "") {
          const quiet = quietBeforeMs + (deps.now() - startedAtMs);
          if (quiet >= giveUpMs) return { gaveUp: true };
          quietMs = quiet;
        }
        return { text };
      } finally {
        discard();
      }
    },
    sendNow() {
      finishCurrent?.();
    },
    recorderStopped(failed) {
      finishCurrent?.(failed);
    },
  };
}
