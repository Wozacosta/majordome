import { describe, expect, it } from "vite-plus/test";

import { prepareText, voiceCount, type SynthTensor } from "./synthesis";
import {
  createSpeechWorker,
  type SpeechWorkerEvent,
  type SpeechWorkerRequest,
} from "./workerProtocol";

const SAMPLE_RATE = 100;
const MODELS = {
  duration_predictor: "duration_predictor.int8.onnx",
  text_encoder: "text_encoder.int8.onnx",
  vector_estimator: "vector_estimator.fp16.onnx",
  vocoder: "vocoder.fp16.onnx",
};

/** Two voices, each a text style of 2x3 and a duration style of 1x2, numbered so they differ. */
function voiceBin(voices = 2): Uint8Array {
  const header = new BigInt64Array([voices, 2, 3, voices, 1, 2].map(BigInt));
  const floats = new Float32Array(voices * 8).map((_, index) => index);
  const bytes = new Uint8Array(48 + floats.byteLength);
  bytes.set(new Uint8Array(header.buffer));
  bytes.set(new Uint8Array(floats.buffer), 48);
  return bytes;
}

function setup(options: { missing?: string; seconds?: number } = {}) {
  const files: Record<string, Uint8Array> = {
    "tts.json": new TextEncoder().encode(
      JSON.stringify({
        ae: { sample_rate: SAMPLE_RATE, base_chunk_size: 5 },
        ttl: { chunk_compress_factor: 2, latent_dim: 3 },
      }),
    ),
    // Every character reads as its own code, so the ids sent to the model can be read back.
    "unicode_indexer.bin": new Uint8Array(Int32Array.from({ length: 128 }, (_, i) => i).buffer),
    "voice.bin": voiceBin(),
  };
  for (const [index, name] of Object.values(MODELS).entries())
    files[name] = new Uint8Array([index]);
  if (options.missing) delete files[options.missing];

  const events: SpeechWorkerEvent[] = [];
  const read: string[] = [];
  const runs: Array<{ model: number; feeds: Record<string, unknown> }> = [];
  const gates: Array<() => void> = [];
  let held = false;
  const waiters: Array<() => void> = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  /** Resolves once `done()` holds, looked at again after every event and every held sentence. */
  const until = async (done: () => boolean) => {
    while (!done()) await new Promise<void>((resolve) => waiters.push(resolve));
  };

  const handle = createSpeechWorker({
    runtime: {
      floats: (data, dims) => ({ data, dims }),
      ints: (data, dims) => ({ data, dims }),
    },
    createSession: async (model) => ({
      run: async (feeds) => {
        runs.push({ model: model[0]!, feeds });
        // The vocoder is the last step of a sentence: holding it holds the sentence.
        if (model[0] === 3 && held) {
          await new Promise<void>((resolve) => {
            gates.push(resolve);
            wake();
          });
        }
        const outputs: Record<string, SynthTensor> = {
          // A hair over, so the 32-bit float does not round the length down a sample.
          duration: { data: new Float32Array([(options.seconds ?? 0.2) * 1.05 + 0.001]) },
          text_emb: { data: new Float32Array(1) },
          denoised_latent: {
            data: (feeds.noisy_latent as SynthTensor | undefined)?.data ?? new Float32Array(0),
          },
          wav_tts: { data: new Float32Array(1_000).fill(0.5) },
        };
        return outputs;
      },
    }),
    readFile: async (name) => {
      read.push(name);
      const bytes = files[name];
      if (!bytes) throw new Error(`${name} is missing`);
      return bytes;
    },
    post: (event) => {
      events.push(event);
      wake();
    },
    now: () => 0,
  });
  return {
    events,
    read,
    runs,
    send: (request: SpeechWorkerRequest) => handle(request),
    load: () => handle({ type: "load", catalogId: "test", models: MODELS }),
    speak: (turn: number, id: number, text = "Hi", voice = 0) =>
      handle({ type: "speak", turn, id, text, voice, lang: "fr" }),
    hold: () => (held = true),
    release: () => {
      held = false;
      for (const gate of gates.splice(0)) gate();
    },
    next: () => new Promise<void>((resolve) => waiters.push(resolve)),
    until,
    holding: () => gates.length > 0,
  };
}

describe("speech worker", () => {
  it("loads the four models one at a time, then the three small files", async () => {
    const worker = setup();
    worker.load();
    await worker.next();
    expect(worker.events).toEqual([{ type: "loaded", voices: 2, loadMs: 0 }]);
    expect(worker.read).toEqual([
      ...Object.values(MODELS),
      "tts.json",
      "unicode_indexer.bin",
      "voice.bin",
    ]);
  });

  it("says why when a file is gone, and can be asked again", async () => {
    const worker = setup({ missing: "voice.bin" });
    worker.load();
    await worker.next();
    expect(worker.events).toEqual([{ type: "load-failed", message: "voice.bin is missing" }]);
    worker.load();
    await worker.next();
    expect(worker.events).toHaveLength(2);
  });

  it("answers a sentence with its sound, cut to the predicted length", async () => {
    const worker = setup({ seconds: 0.2 });
    worker.load();
    await worker.next();
    worker.speak(0, 1, "Hi", 1);
    await worker.next();
    const audio = worker.events[1];
    expect(audio).toMatchObject({ type: "audio", turn: 0, id: 1, sampleRate: SAMPLE_RATE });
    expect(audio?.type === "audio" && audio.samples.length).toBe(20);

    // One duration pass, one encoding, eight denoising passes, one vocoder pass.
    expect(worker.runs.map((run) => run.model)).toEqual([0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
    const first = worker.runs[0]!.feeds as {
      text_ids: { data: BigInt64Array };
      style_dp: { data: Float32Array };
    };
    expect(String.fromCharCode(...Array.from(first.text_ids.data, Number))).toBe("<fr>Hi.</fr>");
    // The second voice's duration style follows both voices' text styles in the file.
    expect([...first.style_dp.data]).toEqual([14, 15]);
  });

  it("speaks sentences in the order they were asked", async () => {
    const worker = setup();
    worker.load();
    worker.speak(0, 1);
    worker.speak(0, 2);
    worker.speak(0, 3);
    await worker.until(() => worker.events.length === 4);
    expect(worker.events.flatMap((event) => (event.type === "audio" ? [event.id] : []))).toEqual([
      1, 2, 3,
    ]);
  });

  it("drops the sentence being made and the ones waiting when the reply is stopped", async () => {
    const worker = setup();
    worker.load();
    await worker.next();
    worker.hold();
    worker.speak(0, 1);
    worker.speak(0, 2);
    await worker.until(worker.holding);
    worker.send({ type: "cancel", turn: 1 });
    worker.speak(1, 3);
    worker.release();
    await worker.until(() => worker.events.length === 2);
    expect(worker.events.slice(1).map((event) => event.type === "audio" && event.id)).toEqual([3]);
    // The second sentence was never started: one sentence's passes for the first, one for the third.
    expect(worker.runs.filter((run) => run.model === 3)).toHaveLength(2);
  });

  it("reports a sentence asked before the voice is loaded", async () => {
    const worker = setup();
    worker.speak(0, 1);
    await worker.next();
    expect(worker.events).toEqual([
      { type: "failed", turn: 0, id: 1, message: "The voice is not loaded." },
    ]);
  });
});

describe("speech text", () => {
  it("wraps a sentence in its language and ends it", () => {
    expect(prepareText("Bonjour  le monde", "fr")).toBe("<fr>Bonjour le monde.</fr>");
    expect(prepareText("Is it “done” ?", "en")).toBe('<en>Is it "done"?</en>');
    expect(prepareText("notes/today_plan 🎉", "en")).toBe("<en>notes today plan.</en>");
  });

  it("reads the number of voices from the head of the voice file", () => {
    expect(voiceCount(voiceBin(10).slice(0, 8))).toBe(10);
    expect(voiceCount(new Uint8Array(0))).toBe(0);
    // A file of anything else must not be taken for billions of voices.
    expect(voiceCount(new TextEncoder().encode("vvvvvvvv"))).toBe(0);
  });
});
