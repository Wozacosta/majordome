import type { VoiceCatalog, VoiceFile } from "./voiceCatalog.ts";

/**
 * The folder the voice lives in, as the platform sees it. Names are relative to
 * that folder. `fetchInto` asks for `bytes=offset-` when the offset is not zero:
 * on 206 it appends to the file, on 200 it replaces it.
 */
export interface VoiceFiles {
  readonly size: (name: string) => Promise<number | null>;
  readonly sha256: (name: string) => Promise<string>;
  readonly fetchInto: (request: {
    readonly url: string;
    readonly name: string;
    readonly offset: number;
    readonly signal: AbortSignal;
    readonly onBytes: (count: number) => void;
  }) => Promise<{ readonly status: number }>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (name: string) => Promise<void>;
}

export type VoiceDownloadFailure = "network" | "verification";

export type VoiceStoreState =
  | { readonly status: "absent" }
  | { readonly status: "downloading"; readonly received: number; readonly total: number }
  | { readonly status: "ready" }
  | { readonly status: "failed"; readonly reason: VoiceDownloadFailure };

export interface VoiceStore {
  readonly getState: () => VoiceStoreState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Looks at the folder. Cheap: sizes only, since a file is renamed into place after its checksum. */
  readonly refresh: () => Promise<VoiceStoreState>;
  /** Fetches what is missing, resuming partial files. Resolves with the state it ended in. */
  readonly download: () => Promise<VoiceStoreState>;
  /** Stops a download and keeps what arrived, so the next one resumes. */
  readonly cancel: () => void;
  readonly remove: () => Promise<void>;
}

const ATTEMPTS = 3;
const partial = (file: VoiceFile) => `${file.name}.part`;

export function createVoiceStore(catalog: VoiceCatalog, files: VoiceFiles): VoiceStore {
  const total = catalog.files.reduce((sum, file) => sum + file.size, 0);
  const listeners = new Set<() => void>();
  let state: VoiceStoreState = { status: "absent" };
  let active: { readonly abort: AbortController; readonly done: Promise<VoiceStoreState> } | null =
    null;

  const set = (next: VoiceStoreState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const installed = async (file: VoiceFile) => (await files.size(file.name)) === file.size;

  const refresh = async () => {
    if (active) return state;
    for (const file of catalog.files) {
      if (!(await installed(file))) {
        if (state.status !== "failed") set({ status: "absent" });
        return state;
      }
    }
    set({ status: "ready" });
    return state;
  };

  const fetchFile = async (file: VoiceFile, signal: AbortSignal, onBytes: (n: number) => void) => {
    const part = partial(file);
    for (let attempt = 1; ; attempt += 1) {
      let offset = (await files.size(part)) ?? 0;
      if (offset > file.size) {
        await files.remove(part);
        offset = 0;
      }
      if (offset < file.size) {
        try {
          const { status } = await files.fetchInto({
            url: `${file.baseUrl ?? catalog.baseUrl}/${file.name}`,
            name: part,
            offset,
            signal,
            onBytes,
          });
          if (status !== 200 && status !== 206) throw new Error(`HTTP ${status}`);
        } catch (error) {
          if (signal.aborted || attempt >= ATTEMPTS) throw error;
          continue;
        }
      }
      if ((await files.size(part)) === file.size) break;
      if (attempt >= ATTEMPTS) throw new Error("incomplete");
    }
    if ((await files.sha256(part)) !== file.sha256) {
      await files.remove(part);
      return false;
    }
    await files.rename(part, file.name);
    return true;
  };

  const run = async (signal: AbortSignal): Promise<VoiceStoreState> => {
    try {
      let received = 0;
      let reported = -1;
      const report = () => {
        // A chunk arrives every few kilobytes; the bar only needs whole percents.
        const step = Math.floor((received / total) * 100);
        if (step === reported) return;
        reported = step;
        set({ status: "downloading", received, total });
      };
      const pending: VoiceFile[] = [];
      for (const file of catalog.files) {
        if (await installed(file)) received += file.size;
        else {
          pending.push(file);
          received += Math.min((await files.size(partial(file))) ?? 0, file.size);
        }
      }
      report();
      for (const file of pending) {
        const before = received - Math.min((await files.size(partial(file))) ?? 0, file.size);
        const verified = await fetchFile(file, signal, (count) => {
          received = Math.min(received + count, total);
          report();
        });
        if (!verified) {
          set({ status: "failed", reason: "verification" });
          return state;
        }
        received = before + file.size;
        report();
      }
      set({ status: "ready" });
    } catch {
      set(signal.aborted ? { status: "absent" } : { status: "failed", reason: "network" });
    }
    return state;
  };

  const cancel = () => active?.abort.abort();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    download: () => {
      if (active) return active.done;
      const abort = new AbortController();
      set({ status: "downloading", received: 0, total });
      const done = run(abort.signal).finally(() => {
        active = null;
      });
      active = { abort, done };
      return done;
    },
    cancel,
    remove: async () => {
      const running = active;
      cancel();
      await running?.done;
      for (const file of catalog.files) {
        await files.remove(file.name);
        await files.remove(partial(file));
      }
      set({ status: "absent" });
    },
  };
}
