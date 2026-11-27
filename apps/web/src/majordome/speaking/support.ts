/** What the window's graphics card offers the voice. */
export interface VoiceSupport {
  /** 16-bit floats in shaders: the fp16 files run three times faster than the int8 ones. */
  readonly halfFloats: boolean;
}

export interface VoiceSupportProbe {
  readonly gpu:
    | {
        readonly requestAdapter: () => Promise<{
          readonly features: { readonly has: (name: string) => boolean };
        } | null>;
      }
    | undefined;
  /** Private storage that can be written from the page, a worker, and an audio output. */
  readonly storage: boolean;
}

/**
 * Whether this window can make speech, and with which files. Without WebGPU it cannot: on one
 * thread of WebAssembly the voice is slower than speech itself, so Read aloud is not offered.
 */
export async function detectVoiceSupport(probe: VoiceSupportProbe): Promise<VoiceSupport | null> {
  if (!probe.gpu || !probe.storage) return null;
  try {
    const adapter = await probe.gpu.requestAdapter();
    return adapter ? { halfFloats: adapter.features.has("shader-f16") } : null;
  } catch {
    return null;
  }
}

export function browserVoiceSupportProbe(): VoiceSupportProbe {
  const hasWindow = typeof window !== "undefined" && typeof navigator !== "undefined";
  return {
    gpu: hasWindow ? (navigator as Navigator & { gpu?: VoiceSupportProbe["gpu"] }).gpu : undefined,
    storage:
      hasWindow &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof FileSystemFileHandle !== "undefined" &&
      "createWritable" in FileSystemFileHandle.prototype &&
      typeof Worker !== "undefined" &&
      typeof AudioContext !== "undefined",
  };
}
