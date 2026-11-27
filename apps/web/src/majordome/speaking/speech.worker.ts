/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import { voiceFolder } from "./voiceFolder";
import { createSpeechWorker, type SpeechWorkerRequest } from "./workerProtocol";

// The app is not cross-origin isolated, so there are no threads to give the CPU parts.
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

let folder: Promise<FileSystemDirectoryHandle> | null = null;

const handle = createSpeechWorker({
  runtime: {
    floats: (data, dims) => new ort.Tensor("float32", data, dims),
    ints: (data, dims) => new ort.Tensor("int64", data, dims),
  },
  createSession: async (model) => {
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
    return {
      run: async (feeds) => {
        const outputs = await session.run(feeds as Record<string, ort.Tensor>);
        return outputs as unknown as Record<string, { data: Float32Array }>;
      },
    };
  },
  readFile: async (name) => {
    if (!folder) throw new Error("The voice folder is not set.");
    const file = await (await (await folder).getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  },
  post: (event, transfer) => self.postMessage(event, { transfer: [...(transfer ?? [])] }),
  now: () => performance.now(),
});

self.addEventListener("message", (event: MessageEvent<SpeechWorkerRequest>) => {
  if (event.data.type === "load") folder ??= voiceFolder(event.data.catalogId);
  handle(event.data);
});
