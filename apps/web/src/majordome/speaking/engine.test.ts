import { webVoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AudioOutput } from "./audioPlayer";
import { createSpeechEngine, type SpeechTiming, type SpeechWorkerHandlers } from "./engine";
import type { SpeechWorkerEvent, SpeechWorkerRequest } from "./workerProtocol";

const SAMPLE_RATE = 10;

function fakeAudio() {
  const started: Array<{ at: number; seconds: number; stopped: boolean; end: () => void }> = [];
  const output = {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      copyToChannel: () => {},
    }),
    createBufferSource: () => {
      let ended = () => {};
      const entry = { at: 0, seconds: 0, stopped: false, end: () => ended() };
      return {
        buffer: null as { duration: number } | null,
        connect: () => {},
        disconnect: () => {},
        addEventListener: (_type: string, listener: () => void) => (ended = listener),
        start(at: number) {
          entry.at = at;
          entry.seconds = this.buffer?.duration ?? 0;
          started.push(entry);
        },
        stop: () => (entry.stopped = true),
      };
    },
  };
  return { started, output: output as unknown as AudioOutput & { currentTime: number } };
}

function setup() {
  const audio = fakeAudio();
  const workers: Array<{
    posted: SpeechWorkerRequest[];
    terminated: boolean;
    handlers: SpeechWorkerHandlers;
  }> = [];
  const timings: SpeechTiming[] = [];
  const clock = { ms: 0 };
  const engine = createSpeechEngine({
    catalog: webVoiceCatalog(true),
    audio: () => audio.output,
    createWorker: (handlers) => {
      const worker = { posted: [] as SpeechWorkerRequest[], terminated: false, handlers };
      workers.push(worker);
      return {
        post: (request) => worker.posted.push(request),
        terminate: () => (worker.terminated = true),
      };
    },
    onTiming: (timing) => timings.push(timing),
    now: () => clock.ms,
  });
  const events = { drained: 0, errors: [] as string[], sounding: [] as boolean[] };
  engine.onDrained(() => (events.drained += 1));
  engine.onError((message) => events.errors.push(message));
  engine.onSounding((value) => events.sounding.push(value));
  const worker = () => workers.at(-1)!;
  const answer = (event: SpeechWorkerEvent) => worker().handlers.onEvent(event);
  const audioFor = (turn: number, id: number, samples = 20) =>
    answer({
      type: "audio",
      turn,
      id,
      samples: new Float32Array(samples),
      sampleRate: SAMPLE_RATE,
      synthMs: 5,
    });
  const ready = async () => {
    const prepared = engine.prepare();
    answer({ type: "loaded", voices: 10, loadMs: 1 });
    await prepared;
  };
  return { engine, audio, workers, worker, answer, audioFor, ready, events, timings, clock };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("speech engine", () => {
  it("starts the worker on first use and tells it which files to load", async () => {
    const { engine, workers, worker, answer } = setup();
    expect(workers).toHaveLength(0);
    const prepared = engine.prepare();
    expect(worker().posted).toEqual([
      {
        type: "load",
        catalogId: "supertonic-3-web-1",
        models: {
          duration_predictor: "duration_predictor.int8.onnx",
          text_encoder: "text_encoder.int8.onnx",
          vector_estimator: "vector_estimator.fp16.onnx",
          vocoder: "vocoder.fp16.onnx",
        },
      },
    ]);
    answer({ type: "loaded", voices: 10, loadMs: 1 });
    await prepared;
    await engine.prepare();
    expect(workers).toHaveLength(1);
  });

  it("plays sentences end to end and says when the last one has finished", async () => {
    const { engine, audio, worker, audioFor, ready, events, timings, clock } = setup();
    await ready();
    engine.speak("One.", { voice: 2, lang: "fr" });
    engine.speak("Two.", { voice: 2, lang: "fr" });
    expect(worker().posted.slice(1)).toEqual([
      { type: "speak", turn: 0, id: 1, text: "One.", voice: 2, lang: "fr" },
      { type: "speak", turn: 0, id: 2, text: "Two.", voice: 2, lang: "fr" },
    ]);
    clock.ms += 300;
    audioFor(0, 1);
    audioFor(0, 2, 30);
    // The second starts where the first ends, after the pause between sentences.
    expect(audio.started.map((source) => [source.at, source.seconds])).toEqual([
      [0.03, 2],
      [2.23, 3],
    ]);
    expect(events.sounding).toEqual([true]);
    expect(timings).toContainEqual({ event: "first-sound", ms: 300 });

    audio.started[0]!.end();
    expect(events.drained).toBe(0);
    audio.started[1]!.end();
    expect(events.drained).toBe(1);
    expect(events.sounding).toEqual([true, false]);
  });

  it("waits for a sentence still being made before saying the reply is over", async () => {
    const { engine, audio, audioFor, ready, events } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    engine.speak("Two.", { voice: 0, lang: "en" });
    audioFor(0, 1);
    audio.started[0]!.end();
    expect(events.drained).toBe(0);
    audioFor(0, 2);
    audio.started[1]!.end();
    expect(events.drained).toBe(1);
  });

  it("falls silent at once on stop and ignores what the stopped reply still sends", async () => {
    const { engine, audio, worker, audioFor, ready, events } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    engine.speak("Two.", { voice: 0, lang: "en" });
    audioFor(0, 1);
    engine.stop();
    expect(audio.started[0]!.stopped).toBe(true);
    expect(worker().posted.at(-1)).toEqual({ type: "cancel", turn: 1 });
    audioFor(0, 2);
    expect(audio.started).toHaveLength(1);
    expect(events.drained).toBe(0);
    expect(events.sounding).toEqual([true, false]);

    engine.speak("Three.", { voice: 0, lang: "en" });
    expect(worker().posted.at(-1)).toMatchObject({ type: "speak", turn: 1, text: "Three." });
  });

  it("ends the worker a few seconds after stop, and loads it again when asked", async () => {
    const { engine, workers, worker, ready, audioFor } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    audioFor(0, 1);
    engine.stop();
    vi.advanceTimersByTime(4_999);
    expect(worker().terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(worker().terminated).toBe(true);
    await ready();
    expect(workers).toHaveLength(2);
  });

  it("keeps the worker when another reply is asked within those seconds", async () => {
    const { engine, worker, ready, audioFor } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    audioFor(0, 1);
    engine.stop();
    vi.advanceTimersByTime(2_000);
    await engine.prepare();
    engine.speak("Two.", { voice: 0, lang: "en" });
    vi.advanceTimersByTime(60_000);
    expect(worker().terminated).toBe(false);
  });

  it("ends the worker after a quiet half minute once a reply has been read", async () => {
    const { engine, audio, worker, ready, audioFor } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    audioFor(0, 1);
    audio.started[0]!.end();
    vi.advanceTimersByTime(29_999);
    expect(worker().terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(worker().terminated).toBe(true);
  });

  it("reports a sentence that failed, once, and frees the worker", async () => {
    const { engine, worker, answer, ready, events } = setup();
    await ready();
    engine.speak("One.", { voice: 0, lang: "en" });
    answer({ type: "failed", turn: 0, id: 1, message: "out of memory" });
    expect(events.errors).toEqual(["out of memory"]);
    expect(worker().terminated).toBe(true);
  });

  it("refuses to prepare when the voice does not load", async () => {
    const { engine, worker, answer } = setup();
    const prepared = engine.prepare();
    answer({ type: "load-failed", message: "voice.bin is missing" });
    await expect(prepared).rejects.toThrow("voice.bin is missing");
    expect(worker().terminated).toBe(true);
  });

  it("refuses to prepare when the worker itself breaks", async () => {
    const { engine, worker } = setup();
    const prepared = engine.prepare();
    worker().handlers.onError("script failed");
    await expect(prepared).rejects.toThrow("script failed");
  });
  it("keeps the worker through silence while a conversation holds it", async () => {
    const { engine, audio, audioFor, ready, worker, events } = setup();
    await ready();
    const release = engine.hold();
    const first = engine.speak("One.", { voice: 0, lang: "en" });
    audioFor(0, first);
    audio.started[0]!.end();
    expect(events.drained).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(worker().terminated).toBe(false);
    engine.stop();
    vi.advanceTimersByTime(120_000);
    expect(worker().terminated).toBe(false);

    release();
    vi.advanceTimersByTime(5_000);
    expect(worker().terminated).toBe(true);
  });

  it("says which sentence starts to sound, and not one that was stopped first", async () => {
    const { engine, audioFor, ready } = setup();
    await ready();
    const sounded: number[] = [];
    engine.onSentence((id) => sounded.push(id));
    const first = engine.speak("One.", { voice: 0, lang: "en" });
    const second = engine.speak("Two.", { voice: 0, lang: "en" });
    audioFor(0, first);
    audioFor(0, second);
    vi.advanceTimersByTime(100);
    expect(sounded).toEqual([first]);
    engine.stop();
    vi.advanceTimersByTime(10_000);
    expect(sounded).toEqual([first]);
  });
});
