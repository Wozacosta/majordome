import {
  MODEL_NAMES,
  parseConfig,
  parseIndexer,
  parseVoices,
  synthesize,
  type ModelName,
  type SynthRuntime,
  type SynthSession,
  type SynthVoice,
} from "./synthesis";

export type SpeechWorkerRequest =
  | {
      readonly type: "load";
      /** Names the folder the files are in. */
      readonly catalogId: string;
      /** The file of each model, as the catalog names it. */
      readonly models: Readonly<Record<ModelName, string>>;
    }
  | {
      readonly type: "speak";
      /** Raised by every stop, so a sentence of a stopped reply is never sent back. */
      readonly turn: number;
      readonly id: number;
      readonly text: string;
      readonly voice: number;
      readonly lang: string;
    }
  | { readonly type: "cancel"; readonly turn: number };

export type SpeechWorkerEvent =
  | { readonly type: "loaded"; readonly voices: number; readonly loadMs: number }
  | { readonly type: "load-failed"; readonly message: string }
  | {
      readonly type: "audio";
      readonly turn: number;
      readonly id: number;
      readonly samples: Float32Array;
      readonly sampleRate: number;
      readonly synthMs: number;
    }
  | {
      readonly type: "failed";
      readonly turn: number;
      readonly id: number;
      readonly message: string;
    };

export interface SpeechWorkerHost {
  readonly runtime: SynthRuntime;
  readonly createSession: (model: Uint8Array) => Promise<SynthSession>;
  readonly readFile: (name: string) => Promise<Uint8Array>;
  readonly post: (event: SpeechWorkerEvent, transfer?: ReadonlyArray<Transferable>) => void;
  readonly now: () => number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The worker's side of the conversation: loads the voice once, then synthesizes the sentences
 * it is sent in order. One sentence runs at a time; a cancel drops the ones waiting and the
 * result of the one running.
 */
export function createSpeechWorker(host: SpeechWorkerHost) {
  let voice: Promise<SynthVoice> | null = null;
  let turn = 0;
  let queue: Promise<void> = Promise.resolve();

  const load = async (models: Readonly<Record<ModelName, string>>): Promise<SynthVoice> => {
    const sessions = {} as Record<ModelName, SynthSession>;
    // One at a time: together, the files and their copies on the graphics card pass 2 GB.
    for (const name of MODEL_NAMES) {
      sessions[name] = await host.createSession(await host.readFile(models[name]));
    }
    return {
      sessions,
      config: parseConfig(new TextDecoder().decode(await host.readFile("tts.json"))),
      indexer: parseIndexer(await host.readFile("unicode_indexer.bin")),
      styles: parseVoices(await host.readFile("voice.bin")),
    };
  };

  return (request: SpeechWorkerRequest): void => {
    if (request.type === "cancel") {
      turn = Math.max(turn, request.turn);
      return;
    }
    if (request.type === "load") {
      const started = host.now();
      const loading = (voice ??= load(request.models));
      loading.then(
        (loaded) =>
          host.post({
            type: "loaded",
            voices: loaded.styles.length,
            loadMs: Math.round(host.now() - started),
          }),
        (error: unknown) => {
          if (voice === loading) voice = null;
          host.post({ type: "load-failed", message: message(error) });
        },
      );
      return;
    }
    turn = Math.max(turn, request.turn);
    queue = queue.then(async () => {
      if (request.turn < turn) return;
      try {
        if (!voice) throw new Error("The voice is not loaded.");
        const started = host.now();
        const samples = await synthesize(host.runtime, await voice, request);
        if (request.turn < turn) return;
        host.post(
          {
            type: "audio",
            turn: request.turn,
            id: request.id,
            samples,
            sampleRate: (await voice).config.sampleRate,
            synthMs: Math.round(host.now() - started),
          },
          [samples.buffer],
        );
      } catch (error) {
        if (request.turn < turn) return;
        host.post({ type: "failed", turn: request.turn, id: request.id, message: message(error) });
      }
    });
  };
}
