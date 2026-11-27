import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";
import { describe, expect, it } from "vite-plus/test";

import { createConversationEars } from "./conversationEars";

const QUIET = -60;
const LOUD = -20;

/** A recorder and a clock the test drives: each `tick` is one 80 ms metering sample. */
function setup(options: {
  readonly transcript?: string | Error;
  readonly noTranscriber?: boolean;
}) {
  let nowMs = 0;
  let level: number | null = null;
  let tick: (() => void) | null = null;
  const log: Array<string> = [];
  let recordings = 0;
  const transcriber: VoiceTranscriber = {
    prepare: async () => ({
      locale: "en-US",
      transcribe: async (uri) => {
        log.push(`transcribe ${uri}`);
        if (options.transcript instanceof Error) throw options.transcript;
        return options.transcript ?? "";
      },
    }),
  };
  const ears = createConversationEars({
    recorder: {
      get uri() {
        return `file:///turn-${recordings}.m4a`;
      },
      prepareToRecordAsync: async () => {
        recordings += 1;
      },
      record: () => {
        level = QUIET;
        log.push("record");
      },
      stop: async () => {
        level = null;
        log.push("stop");
      },
      level: () => level,
    },
    getTranscriber: () => (options.noTranscriber ? null : transcriber),
    deleteRecording: (uri) => void log.push(`delete ${uri}`),
    now: () => nowMs,
    every: (callback) => {
      tick = callback;
      return () => {
        tick = null;
      };
    },
  });
  return {
    ears,
    log,
    wait: (ms: number) => {
      nowMs += ms;
    },
    /** Feeds `ms` of microphone at one level, a sample every 80 ms. */
    hear: async (db: number, ms: number) => {
      // The recorder starts after two awaited steps.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      for (let elapsed = 0; elapsed < ms; elapsed += 80) {
        // The turn may end partway through: the recorder stops being sampled.
        const sample = tick as (() => void) | null;
        if (!sample) break;
        nowMs += 80;
        level = db;
        sample();
      }
    },
  };
}

describe("conversation ears", () => {
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
      "transcribe file:///turn-1.m4a",
      "delete file:///turn-1.m4a",
    ]);
  });

  it("sends at once when Send is tapped", async () => {
    const { ears, hear } = setup({ transcript: "Send this" });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 800);
    ears.sendNow();
    expect(await heard).toEqual({ text: "Send this" });
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

    // The assistant talks for a minute before the phone listens again.
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
    expect(log).toEqual(["record", "stop", "delete file:///turn-1.m4a"]);
  });

  it("stops recording and transcribes nothing when the conversation moves on", async () => {
    const { ears, hear, log } = setup({ transcript: "too late" });
    const abort = new AbortController();
    const heard = ears.listen(abort.signal);
    await hear(LOUD, 800);
    abort.abort(new Error("interrupted"));
    await expect(heard).rejects.toThrow("interrupted");
    expect(log).toEqual(["record", "stop", "delete file:///turn-1.m4a"]);
  });

  it("fails when the recorder does, with its reason", async () => {
    const { ears, hear } = setup({ transcript: "unused" });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 400);
    ears.recorderStopped("The microphone was disconnected.");
    await expect(heard).rejects.toThrow("The microphone was disconnected.");
  });

  it("fails when the transcription does, and still deletes the recording", async () => {
    const { ears, hear, log } = setup({ transcript: new Error("No model for this language.") });
    const heard = ears.listen(new AbortController().signal);
    await hear(LOUD, 400);
    ears.sendNow();
    await expect(heard).rejects.toThrow("No model for this language.");
    expect(log.at(-1)).toBe("delete file:///turn-1.m4a");
  });

  it("refuses to listen where nothing can transcribe", async () => {
    const { ears } = setup({ noTranscriber: true });
    await expect(ears.listen(new AbortController().signal)).rejects.toThrow(
      "Voice transcription is not available.",
    );
  });
});
