import { webVoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { describe, expect, it } from "vite-plus/test";

import { modelFiles } from "./engine";
import { detectVoiceSupport } from "./support";

const adapter = (features: ReadonlyArray<string>) => ({
  requestAdapter: async () => ({ features: { has: (name: string) => features.includes(name) } }),
});

describe("voice support", () => {
  it("is not offered without WebGPU", async () => {
    expect(await detectVoiceSupport({ gpu: undefined, storage: true })).toBeNull();
  });

  it("is not offered when the browser has WebGPU but no graphics card to give", async () => {
    const gpu = { requestAdapter: async () => null };
    expect(await detectVoiceSupport({ gpu, storage: true })).toBeNull();
  });

  it("is not offered when asking for the graphics card fails", async () => {
    const gpu = { requestAdapter: () => Promise.reject(new Error("blocked")) };
    expect(await detectVoiceSupport({ gpu, storage: true })).toBeNull();
  });

  it("is not offered without storage to keep the voice in", async () => {
    expect(await detectVoiceSupport({ gpu: adapter(["shader-f16"]), storage: false })).toBeNull();
  });

  it("uses the fp16 files for the two large models when shaders have 16-bit floats", async () => {
    const support = await detectVoiceSupport({ gpu: adapter(["shader-f16"]), storage: true });
    expect(support).toEqual({ halfFloats: true });
    expect(modelFiles(webVoiceCatalog(support!.halfFloats))).toEqual({
      duration_predictor: "duration_predictor.int8.onnx",
      text_encoder: "text_encoder.int8.onnx",
      vector_estimator: "vector_estimator.fp16.onnx",
      vocoder: "vocoder.fp16.onnx",
    });
  });

  it("uses the int8 files otherwise", async () => {
    const support = await detectVoiceSupport({
      gpu: adapter(["texture-compression-bc"]),
      storage: true,
    });
    expect(support).toEqual({ halfFloats: false });
    expect(modelFiles(webVoiceCatalog(support!.halfFloats))).toEqual({
      duration_predictor: "duration_predictor.int8.onnx",
      text_encoder: "text_encoder.int8.onnx",
      vector_estimator: "vector_estimator.int8.onnx",
      vocoder: "vocoder.int8.onnx",
    });
  });
});
