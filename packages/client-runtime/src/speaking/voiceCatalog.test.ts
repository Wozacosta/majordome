import { describe, expect, it } from "vite-plus/test";

import { VOICE_CATALOG, voiceDownloadMegabytes, webVoiceCatalog } from "./voiceCatalog.ts";

const names = (catalog: { files: ReadonlyArray<{ name: string }> }) =>
  catalog.files.map((file) => file.name);
const urls = (catalog: ReturnType<typeof webVoiceCatalog>) =>
  catalog.files.map((file) => `${file.baseUrl ?? catalog.baseUrl}/${file.name}`);

describe("voice catalog", () => {
  it("keeps the phone on the files GitHub serves", () => {
    expect(VOICE_CATALOG.baseUrl).toBe(
      "https://github.com/Wozacosta/majordome/releases/download/voice-supertonic-3-int8-1",
    );
    expect(VOICE_CATALOG.files.every((file) => file.baseUrl === undefined)).toBe(true);
    expect(voiceDownloadMegabytes()).toBe(145);
  });

  it("gives a window without 16-bit floats the same files through the CORS host", () => {
    const catalog = webVoiceCatalog(false);
    expect(catalog.id).toBe(VOICE_CATALOG.id);
    expect(names(catalog)).toEqual(names(VOICE_CATALOG));
    expect(new Set(urls(catalog).map((url) => url.slice(0, url.lastIndexOf("/"))))).toEqual(
      new Set(["https://majord.link/voice/voice-supertonic-3-int8-1"]),
    );
  });

  it("swaps the two large models for their fp16 files when the graphics card has them", () => {
    const catalog = webVoiceCatalog(true);
    expect(catalog.id).not.toBe(VOICE_CATALOG.id);
    expect(names(catalog).toSorted()).toEqual([
      "duration_predictor.int8.onnx",
      "text_encoder.int8.onnx",
      "tts.json",
      "unicode_indexer.bin",
      "vector_estimator.fp16.onnx",
      "vocoder.fp16.onnx",
      "voice.bin",
    ]);
    expect(urls(catalog)).toContain(
      "https://majord.link/voice/voice-supertonic-3-web-1/vocoder.fp16.onnx",
    );
    expect(urls(catalog)).toContain(
      "https://majord.link/voice/voice-supertonic-3-int8-1/voice.bin",
    );
    expect(voiceDownloadMegabytes(catalog)).toBe(220);
  });

  it("fetches from another host when told to", () => {
    expect(urls(webVoiceCatalog(true, "http://127.0.0.1:4800/voice"))).toContain(
      "http://127.0.0.1:4800/voice/voice-supertonic-3-web-1/vector_estimator.fp16.onnx",
    );
  });
});
