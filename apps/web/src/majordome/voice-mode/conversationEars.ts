import {
  createEndOfTurnDetector,
  type ConversationHeard,
  type EndOfTurnOptions,
} from "@t3tools/client-runtime/speaking";
import type { VoiceRecorder, VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

/** One recording that transcribes where dictation does: what `createBrowserPcmCapture` returns. */
export interface EarsCapture {
  readonly recorder: VoiceRecorder;
  readonly transcriber: VoiceTranscriber;
  readonly cancelRecording: () => void;
  readonly deleteRecording: (uri: string) => void;
}

export interface EarsCaptureEvents {
  /** The microphone's level, 0 to 1, about twenty times a second while recording. */
  readonly onLevel: (level: number) => void;
  readonly onDurationLimit: () => void;
  readonly onError: (message: string) => void;
}

export interface ConversationEarsDeps {
  /** Opens a recording for wherever the user's dictation is transcribed; null when nowhere is. */
  readonly open: (events: EarsCaptureEvents) => EarsCapture | null;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  readonly endOfTurn?: EndOfTurnOptions;
  /** The longest one turn may be, in seconds; what was said by then is sent. */
  readonly longestTurnSeconds?: number;
}

export interface ConversationEars {
  listen(signal: AbortSignal): Promise<ConversationHeard>;
  /** The user pressed Send: what was recorded so far is the turn. */
  sendNow(): void;
}

const DEFAULT_GIVE_UP_MS = 30_000;
const DEFAULT_LONGEST_TURN_SECONDS = 180;
/** The capture's meter is `min(1, rms * 4)`. */
const METER_GAIN = 4;
/** A microphone that reports no level at all still ends the wait, this long after it should have. */
const SILENT_METER_GRACE_MS = 5_000;

/** Failures the capture already worded for the user. */
const worded = new WeakSet<object>();

/** Whether an error from `listen` carries a message written for the user, in their language. */
export const isWordedEarsError = (error: unknown): error is Error =>
  error instanceof Error && worded.has(error);

const MICROPHONE_START_MS = 15_000;

type Outcome = "ended" | "gave-up" | { readonly failed: string };

/** The capture's level as dBFS; silence is far below any threshold. */
export function meterLevelToDb(level: number): number {
  return level > 0 ? 20 * Math.log10(level / METER_GAIN) : -160;
}

/**
 * Hears one turn of a conversation: records until the speaker stops, or Send is pressed, then
 * transcribes where the user's dictation does. Unlike dictation it returns the words instead of
 * writing them into a draft.
 */
export function createConversationEars(deps: ConversationEarsDeps): ConversationEars {
  const giveUpMs = deps.endOfTurn?.giveUpMs ?? DEFAULT_GIVE_UP_MS;
  let finishCurrent: (() => void) | null = null;
  // An empty transcript listens again without restarting the wait for a first word: this is
  // how long the listening before it went on with nothing heard.
  let quietMs = 0;

  return {
    async listen(signal) {
      const startedAtMs = deps.now();
      const quietBeforeMs = quietMs;
      quietMs = 0;
      const waitMs = Math.max(0, giveUpMs - quietBeforeMs);
      const detector = createEndOfTurnDetector({ ...deps.endOfTurn, giveUpMs: waitMs });

      // The capture reports from the moment it opens; the turn starts listening a little later.
      let early: Outcome | null = null;
      let settle = (outcome: Outcome) => {
        early ??= outcome;
      };
      let recording = false;
      const capture = deps.open({
        onLevel: (level) => {
          if (!recording) return;
          const status = detector.push({ db: meterLevelToDb(level), atMs: deps.now() });
          if (status === "ended" || status === "gave-up") settle(status);
        },
        onDurationLimit: () => settle("ended"),
        onError: (message) => settle({ failed: message }),
      });
      if (!capture) throw new Error("voice-mode: no transcription destination");

      let uri: string | null = null;
      try {
        const transcription = await capture.transcriber.prepare({ signal });
        // A browser that will not start audio without a new click leaves this pending for good.
        await new Promise<void>((resolve, reject) => {
          const cancel = deps.setTimer(
            () => reject(new Error("voice-mode: microphone did not start")),
            MICROPHONE_START_MS,
          );
          capture.recorder.prepareToRecordAsync(signal).then(resolve, reject).finally(cancel);
        });

        const outcome = await new Promise<Outcome>((resolve) => {
          let cancelTimer: (() => void) | null = null;
          const done = (result: Outcome) => {
            if (finishCurrent === null) return;
            finishCurrent = null;
            recording = false;
            cancelTimer?.();
            signal.removeEventListener("abort", onAbort);
            resolve(result);
          };
          const onAbort = () => done("ended");
          finishCurrent = () => done("ended");
          settle = done;
          if (early) return done(early);
          if (signal.aborted) return done("ended");
          signal.addEventListener("abort", onAbort, { once: true });
          capture.recorder.record({
            forDuration: deps.longestTurnSeconds ?? DEFAULT_LONGEST_TURN_SECONDS,
          });
          recording = true;
          cancelTimer = deps.setTimer(() => {
            if (detector.push({ db: -160, atMs: deps.now() }) !== "speaking") done("gave-up");
          }, waitMs + SILENT_METER_GRACE_MS);
        });

        await capture.recorder.stop().catch(() => {});
        uri = capture.recorder.uri;
        if (signal.aborted) throw signal.reason ?? new Error("voice-mode: listening stopped");
        if (typeof outcome === "object") {
          const failure = new Error(outcome.failed);
          worded.add(failure);
          throw failure;
        }
        if (outcome === "gave-up") return { gaveUp: true };
        const text = (
          transcription.streaming
            ? await transcription.streaming.finish({ signal })
            : uri
              ? await transcription.transcribe(uri, { signal })
              : ""
        ).trim();
        if (text === "") {
          const quiet = quietBeforeMs + (deps.now() - startedAtMs);
          if (quiet >= giveUpMs) return { gaveUp: true };
          quietMs = quiet;
        }
        return { text };
      } finally {
        finishCurrent = null;
        uri ??= capture.recorder.uri;
        if (uri) capture.deleteRecording(uri);
        capture.cancelRecording();
      }
    },
    sendNow() {
      finishCurrent?.();
    },
  };
}
