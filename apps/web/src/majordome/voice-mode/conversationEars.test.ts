import { describe, expect, it } from "vite-plus/test";

import {
  createConversationEars,
  isWordedEarsError,
  meterLevelToDb,
  type EarsCaptureEvents,
} from "./conversationEars";

/** The capture's meter for a quiet room and for someone talking (`min(1, rms * 4)`). */
const QUIET = 0.004;
const LOUD = 0.4;

/** A capture and a clock the test drives: each sample is one 50 ms level from the worklet. */
function setup(options: {
  readonly transcript?: string | Error;
  readonly streamed?: string;
  readonly nowhere?: boolean;
  readonly microphoneNeverStarts?: boolean;
}) {
  let nowMs = 0;
  let events: EarsCaptureEvents | null = null;
  let recording = false;
  let recordings = 0;
  const log: Array<string> = [];
  const timers = new Set<{ readonly at: number; readonly run: () => void }>();
  const ears = createConversationEars({
    open: (handlers) => {
      if (options.nowhere) return null;
      events = handlers;
      return {
        recorder: {
          get uri() {
            return recordings > 0 && !recording ? `blob:turn-${recordings}` : null;
          },
          prepareToRecordAsync: async () => {
            if (options.microphoneNeverStarts) await new Promise(() => {});
            recordings += 1;
          },
          record: () => {
            recording = true;
            log.push("record");
          },
          stop: async () => {
            recording = false;
            log.push("stop");
          },
        },
        transcriber: {
          prepare: async () => ({
            locale: "en-US",
            ...(options.streamed === undefined
              ? {}
              : {
                  streaming: {
                    finish: async () => {
                      log.push("finish stream");
                      return options.streamed ?? "";
                    },
                  },
                }),
            transcribe: async (uri) => {
              log.push(`transcribe ${uri}`);
              if (options.transcript instanceof Error) throw options.transcript;
              return options.transcript ?? "";
            },
          }),
        },
        cancelRecording: () => void log.push("release"),
        deleteRecording: (uri) => void log.push(`delete ${uri}`),
      };
    },
    now: () => nowMs,
    setTimer: (run, ms) => {
      const timer = { at: nowMs + ms, run };
      timers.add(timer);
      return () => void timers.delete(timer);
    },
  });
  const isRecording = () => recording;
  const settle = async () => {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  };
  return {
    ears,
    log,
    events: () => events,
    settle,
    wait: (ms: number) => {
      nowMs += ms;
    },
    /** Lets `ms` pass with no level at all from the microphone. */
    silence: async (ms: number) => {
      await settle();
      nowMs += ms;
      for (const timer of Array.from(timers)) {
        if (timer.at > nowMs) continue;
        timers.delete(timer);
        timer.run();
      }
    },
    /** Feeds `ms` of microphone at one level, a sample every 50 ms. */
    hear: async (level: number, ms: number) => {
      await settle();
      for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        // The turn may end partway through: the capture stops reporting.
        if (!isRecording()) break;
        nowMs += 50;
        events?.onLevel(level);
      }
    },
  };
}

describe("conversation ears in the window", () => {
  it("reads the capture's meter as decibels", () => {
    expect(meterLevelToDb(0)).toBe(-160);
    expect(meterLevelToDb(QUIET)).toBeCloseTo(-60, 0);
    expect(meterLevelToDb(LOUD)).toBeCloseTo(-20, 0);
  });

  it("ends the turn two seconds after the speaker stops, and returns the words", async () => {
    const { ears, hear, log } = setup({ transcript: " What is on today? " });
    const heard = ears.listen(new AbortController().signal);
    await hear(QUIET, 1_000);
    await hear(LOUD, 1_200);
    await hear(QUIET, 1_900);
    expect(log).toEqual(["record"]);
    await hear(QUIET, 200);
    expect(await heard).toEqual({ text: "What is on today?" });
    expect(log).toEqual([
      "record",
      "stop",
      "transcribe blob:turn-1",
      "delete blob:turn-1",
      "release",
    ]);
  });

  it("sends at once when Send is pressed", async () => {
    const { ears, hear } = setup({ transcript: "Send this" });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 800);
    ears.sendNow();
    expect(await heard).toEqual({ text: "Send this" });
  });

  it("takes the words from a transcription that ran while recording", async () => {
    const { ears, hear, log } = setup({ streamed: "Heard as it was said", transcript: "unused" });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 800);
    ears.sendNow();
    expect(await heard).toEqual({ text: "Heard as it was said" });
    expect(log).toContain("finish stream");
    expect(log.some((entry) => entry.startsWith("transcribe"))).toBe(false);
  });

  it("returns nothing for a noise that was not words, without restarting the wait", async () => {
    const { ears, hear } = setup({ transcript: "" });
    const first = ears.listen(new AbortController().signal);
    await hear(QUIET, 14_000);
    await hear(LOUD, 1_000);
    await hear(QUIET, 2_100);
    expect(await first).toEqual({ text: "" });

    // 17 s of nothing have passed; 13 s more is the 30 s of nothing heard.
    const second = ears.listen(new AbortController().signal);
    await hear(QUIET, 12_800);
    await hear(QUIET, 400);
    expect(await second).toEqual({ gaveUp: true });
  });

  it("counts only time spent listening: an answer in between does not use up the wait", async () => {
    const { ears, hear, wait } = setup({ transcript: "" });
    const first = ears.listen(new AbortController().signal);
    await hear(LOUD, 800);
    ears.sendNow();
    expect(await first).toEqual({ text: "" });

    // The assistant talks for a minute before the computer listens again.
    wait(60_000);
    const second = ears.listen(new AbortController().signal);
    await hear(QUIET, 20_000);
    await hear(LOUD, 800);
    ears.sendNow();
    expect(await second).toEqual({ text: "" });
  });

  it("gives up after thirty seconds in which nobody spoke", async () => {
    const { ears, hear, log } = setup({ transcript: "never asked" });
    const heard = ears.listen(new AbortController().signal);
    await hear(QUIET, 30_100);
    expect(await heard).toEqual({ gaveUp: true });
    expect(log).toEqual(["record", "stop", "delete blob:turn-1", "release"]);
  });

  it("gives up when the microphone reports nothing at all", async () => {
    const { ears, silence } = setup({ transcript: "never asked" });
    const heard = ears.listen(new AbortController().signal);
    await silence(34_000);
    await silence(1_000);
    expect(await heard).toEqual({ gaveUp: true });
  });

  it("stops recording and transcribes nothing when the conversation moves on", async () => {
    const { ears, hear, log } = setup({ transcript: "too late" });
    const abort = new AbortController();
    const heard = ears.listen(abort.signal);
    await hear(LOUD, 800);
    abort.abort(new Error("interrupted"));
    await expect(heard).rejects.toThrow("interrupted");
    expect(log).toEqual(["record", "stop", "delete blob:turn-1", "release"]);
  });

  it("fails when the microphone does, with the reason it gave", async () => {
    const { ears, hear, events } = setup({ transcript: "unused" });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 400);
    events()?.onError("The microphone disconnected.");
    const error = await heard.catch((caught: unknown) => caught);
    expect(error).toHaveProperty("message", "The microphone disconnected.");
    expect(isWordedEarsError(error)).toBe(true);
  });

  it("fails when the transcription does, and still lets the recording go", async () => {
    const { ears, hear, log } = setup({ transcript: new Error("no model") });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 400);
    ears.sendNow();
    await expect(heard).rejects.toThrow("no model");
    expect(log.slice(-2)).toEqual(["delete blob:turn-1", "release"]);
  });

  it("refuses to listen where nothing can transcribe", async () => {
    const { ears } = setup({ nowhere: true });
    await expect(ears.listen(new AbortController().signal)).rejects.toThrow(
      "voice-mode: no transcription destination",
    );
  });
  it("fails instead of waiting for good on a microphone that never starts", async () => {
    const { ears, silence, log } = setup({ microphoneNeverStarts: true });
    const heard = ears.listen(new AbortController().signal);
    const failure = heard.catch((caught: unknown) => caught);
    await silence(15_000);
    expect(await failure).toHaveProperty("message", "voice-mode: microphone did not start");
    expect(log).toEqual(["release"]);
  });
});
