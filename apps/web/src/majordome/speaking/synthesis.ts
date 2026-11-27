/**
 * Supertonic 3 synthesis over an ONNX runtime, one sentence at a time. Adapted from
 * supertone-inc/supertonic `web/helper.js` (MIT), with typed arrays instead of nested lists and
 * readers for sherpa-onnx's `voice.bin` and `unicode_indexer.bin`.
 */

export const MODEL_NAMES = [
  "duration_predictor",
  "text_encoder",
  "vector_estimator",
  "vocoder",
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export interface SynthTensor {
  readonly data: Float32Array;
}

export interface SynthSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, SynthTensor>>;
}

/** What synthesis needs from onnxruntime; a test passes a fake. */
export interface SynthRuntime {
  floats(data: Float32Array, dims: ReadonlyArray<number>): unknown;
  ints(data: BigInt64Array, dims: ReadonlyArray<number>): unknown;
}

export interface VoiceStyle {
  readonly ttl: { readonly data: Float32Array; readonly dims: ReadonlyArray<number> };
  readonly dp: { readonly data: Float32Array; readonly dims: ReadonlyArray<number> };
}

export interface SynthConfig {
  readonly sampleRate: number;
  readonly chunkSize: number;
  readonly latentDim: number;
}

export interface SynthVoice {
  readonly sessions: Readonly<Record<ModelName, SynthSession>>;
  readonly config: SynthConfig;
  readonly indexer: Int32Array;
  readonly styles: ReadonlyArray<VoiceStyle>;
}

/** Denoising passes: eight is where the proof measured speed and quality. */
const STEPS = 8;
const SPEED = 1.05;
const VOICE_HEADER_BYTES = 48;
export const MAX_VOICES = 64;

/** How many voices a `voice.bin` holds, from its header alone. */
export function voiceCount(header: Uint8Array): number {
  if (header.byteLength < 8) return 0;
  const count = Number(new DataView(header.buffer, header.byteOffset, 8).getBigInt64(0, true));
  // A file that is not a voice file reads as any number at all.
  return count >= 1 && count <= MAX_VOICES ? count : 0;
}

/**
 * sherpa-onnx `voice.bin`: six little-endian int64 (voices, 50, 256, voices, 8, 16), then every
 * voice's text style, then every voice's duration style, as float32.
 */
export function parseVoices(bytes: Uint8Array): ReadonlyArray<VoiceStyle> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = Array.from({ length: 6 }, (_, index) => Number(view.getBigInt64(index * 8, true)));
  const [count = 0, t1 = 0, t2 = 0, , d1 = 0, d2 = 0] = header;
  const ttl = t1 * t2;
  const dp = d1 * d2;
  if (bytes.byteLength !== VOICE_HEADER_BYTES + count * (ttl + dp) * 4) {
    throw new Error("The voice file is not the expected size.");
  }
  const floats = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset + VOICE_HEADER_BYTES, bytes.byteOffset + bytes.byteLength),
  );
  return Array.from({ length: count }, (_, voice) => ({
    ttl: { data: floats.slice(voice * ttl, (voice + 1) * ttl), dims: [1, t1, t2] },
    dp: {
      data: floats.slice(count * ttl + voice * dp, count * ttl + (voice + 1) * dp),
      dims: [1, d1, d2],
    },
  }));
}

/** `unicode_indexer.bin`: one int32 per code point of the basic plane. */
export function parseIndexer(bytes: Uint8Array): Int32Array {
  return new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function parseConfig(json: string): SynthConfig {
  const config = JSON.parse(json) as {
    ae: { sample_rate: number; base_chunk_size: number };
    ttl: { chunk_compress_factor: number; latent_dim: number };
  };
  return {
    sampleRate: config.ae.sample_rate,
    chunkSize: config.ae.base_chunk_size * config.ttl.chunk_compress_factor,
    latentDim: config.ttl.latent_dim * config.ttl.chunk_compress_factor,
  };
}

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  // En dash, non-breaking hyphen and em dash, by code so the file holds none of them.
  [String.fromCharCode(0x2013), "-"],
  [String.fromCharCode(0x2011), "-"],
  [String.fromCharCode(0x2014), "-"],
  ["_", " "],
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["´", "'"],
  ["`", "'"],
  ["[", " "],
  ["]", " "],
  ["|", " "],
  ["/", " "],
  ["#", " "],
  ["→", " "],
  ["←", " "],
  ["@", " at "],
];
const ENDS_SENTENCE = /[.!?;:,'"')\]}…。」』】〉》›»]$/;

/** The text as the model was trained to read it, wrapped in its language tag. */
export function prepareText(text: string, lang: string): string {
  let prepared = text.normalize("NFKD").replace(EMOJI, "");
  for (const [from, to] of REPLACEMENTS) prepared = prepared.replaceAll(from, to);
  prepared = prepared
    .replace(/[♥☆♡©\\]/g, "")
    .replace(/ ([,.!?;:'])/g, "$1")
    .replace(/"{2,}/g, '"')
    .replace(/'{2,}/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!ENDS_SENTENCE.test(prepared)) prepared += ".";
  return `<${lang}>${prepared}</${lang}>`;
}

function noise(length: number): Float32Array {
  const values = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const radius = Math.sqrt(-2 * Math.log(Math.max(0.0001, Math.random())));
    values[index] = radius * Math.cos(2 * Math.PI * Math.random());
  }
  return values;
}

/** One sentence as mono samples at the voice's sample rate. */
export async function synthesize(
  runtime: SynthRuntime,
  voice: SynthVoice,
  request: { readonly text: string; readonly voice: number; readonly lang: string },
): Promise<Float32Array> {
  const { sessions, config, indexer } = voice;
  const style = voice.styles[request.voice] ?? voice.styles[0];
  if (!style) throw new Error("The voice file holds no voice.");

  const text = prepareText(request.text, request.lang);
  const ids = new BigInt64Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    ids[index] = BigInt(code < indexer.length ? indexer[code]! : -1);
  }
  const textIds = runtime.ints(ids, [1, ids.length]);
  const textMask = runtime.floats(new Float32Array(ids.length).fill(1), [1, 1, ids.length]);
  const styleTtl = runtime.floats(style.ttl.data, style.ttl.dims);
  const styleDp = runtime.floats(style.dp.data, style.dp.dims);

  const predicted = await sessions.duration_predictor.run({
    text_ids: textIds,
    style_dp: styleDp,
    text_mask: textMask,
  });
  const seconds = predicted.duration!.data[0]! / SPEED;
  const encoded = await sessions.text_encoder.run({
    text_ids: textIds,
    style_ttl: styleTtl,
    text_mask: textMask,
  });

  const samples = Math.floor(seconds * config.sampleRate);
  const frames = Math.floor((samples + config.chunkSize - 1) / config.chunkSize);
  const latentDims = [1, config.latentDim, frames];
  const latentMask = runtime.floats(new Float32Array(frames).fill(1), [1, 1, frames]);
  const totalStep = runtime.floats(new Float32Array([STEPS]), [1]);
  let latent = noise(config.latentDim * frames);
  for (let step = 0; step < STEPS; step += 1) {
    const denoised = await sessions.vector_estimator.run({
      noisy_latent: runtime.floats(latent, latentDims),
      text_emb: encoded.text_emb,
      style_ttl: styleTtl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: runtime.floats(new Float32Array([step]), [1]),
      total_step: totalStep,
    });
    latent = denoised.denoised_latent!.data;
  }
  const decoded = await sessions.vocoder.run({ latent: runtime.floats(latent, latentDims) });
  const wave = decoded.wav_tts!.data;
  return new Float32Array(wave.subarray(0, Math.min(wave.length, samples)));
}
