/**
 * "Read aloud" on a reply: one reply speaks at a time, and the same action
 * stops it. The engine, the audio session and the voice files are injected, so
 * this runs unchanged on the phone, in the window, and in tests.
 */

export interface ReadAloudEngine {
  /** Loads the voice if it is not in memory yet. */
  readonly prepare: () => Promise<void>;
  /** Queues one sentence. */
  readonly speak: (
    text: string,
    options: { readonly voice: number; readonly lang: string },
  ) => void;
  /** Silences at once and drops the queue. */
  readonly stop: () => void;
  readonly onDrained: (listener: () => void) => () => void;
  readonly onError: (listener: (message: string) => void) => () => void;
}

export interface ReadAloudRequest {
  /** Identifies the reply, so its action shows Stop. */
  readonly key: string;
  readonly markdown: string;
  /** Speaks with this voice instead of the chosen one, to sample it. */
  readonly voice?: number;
}

export interface ReadAloudDependencies {
  readonly engine: ReadAloudEngine;
  readonly voiceReady: () => Promise<boolean>;
  /** Called instead of speaking when the voice is not on the device. */
  readonly offerDownload: (request: ReadAloudRequest) => void;
  /**
   * Takes the device's audio output. Resolves with how to give it back, or null
   * when something else holds it (a recording). `onTaken` fires when another
   * owner takes it away.
   */
  readonly takeAudio: (onTaken: () => void) => Promise<(() => void) | null>;
  readonly sentences: (markdown: string) => ReadonlyArray<string>;
  readonly language: (text: string) => string;
  readonly voice: () => number;
  /** Waits for a screen reader to finish announcing the action. */
  readonly settle?: () => Promise<void>;
  readonly onError?: (message: string) => void;
}

export type ReadAloudState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" | "speaking"; readonly key: string };

const IDLE: ReadAloudState = { status: "idle" };

export class ReadAloudController {
  private state: ReadAloudState = IDLE;
  private readonly listeners = new Set<() => void>();
  private turn = 0;
  private release: (() => void) | null = null;
  private readonly unsubscribe: ReadonlyArray<() => void>;
  private readonly dependencies: ReadAloudDependencies;

  constructor(dependencies: ReadAloudDependencies) {
    this.dependencies = dependencies;
    this.unsubscribe = [
      dependencies.engine.onDrained(() => {
        if (this.state.status === "speaking") this.finish();
      }),
      dependencies.engine.onError((message) => {
        if (this.state.status === "idle") return;
        this.finish();
        dependencies.onError?.(message);
      }),
    ];
  }

  readonly getState = (): ReadAloudState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether `key` is the reply being read, so its action is Stop. */
  isActive(key: string): boolean {
    return this.state.status !== "idle" && this.state.key === key;
  }

  /** Reads the reply, or stops it when it is the one being read. */
  toggle(request: ReadAloudRequest): Promise<void> {
    if (this.isActive(request.key)) {
      this.stop();
      return Promise.resolve();
    }
    return this.start(request);
  }

  async start(request: ReadAloudRequest): Promise<void> {
    this.stop();
    const turn = this.turn;
    const current = () => turn === this.turn;
    const { engine } = this.dependencies;
    this.set({ status: "preparing", key: request.key });
    try {
      if (!(await this.dependencies.voiceReady())) {
        if (!current()) return;
        this.finish();
        this.dependencies.offerDownload(request);
        return;
      }
      if (!current()) return;
      const sentences = this.dependencies.sentences(request.markdown);
      if (sentences.length === 0) return this.finish();
      const release = await this.dependencies.takeAudio(() => {
        if (current()) this.stop();
      });
      if (!current()) return release?.();
      if (!release) return this.finish();
      this.release = release;
      await this.dependencies.settle?.();
      if (!current()) return;
      await engine.prepare();
      if (!current()) return;
      const options = {
        voice: request.voice ?? this.dependencies.voice(),
        lang: this.dependencies.language(sentences.join(" ")),
      };
      this.set({ status: "speaking", key: request.key });
      for (const sentence of sentences) engine.speak(sentence, options);
    } catch (error) {
      if (!current()) return;
      this.finish();
      this.dependencies.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    if (this.state.status === "idle") return;
    this.dependencies.engine.stop();
    this.finish();
  }

  dispose(): void {
    this.stop();
    for (const remove of this.unsubscribe) remove();
  }

  private finish(): void {
    this.turn += 1;
    const release = this.release;
    this.release = null;
    release?.();
    this.set(IDLE);
  }

  private set(next: ReadAloudState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
