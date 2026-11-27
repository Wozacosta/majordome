/** The pause between two sentences, as the voice's own sample code leaves. */
const SENTENCE_PAUSE_SECONDS = 0.2;
const LEAD_SECONDS = 0.03;

/** As much of an AudioContext as playing sentences needs. */
export interface AudioOutput {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
}

/**
 * Plays sentences end to end on one audio clock: each is scheduled to start where the one
 * before it ends, so there is no gap to hear and nothing to update while it plays.
 */
export function createAudioPlayer(output: () => AudioOutput, onIdle: () => void) {
  const playing = new Set<AudioBufferSourceNode>();
  let next = 0;

  return {
    get busy() {
      return playing.size > 0;
    },
    /** Queues one sentence and returns how many seconds from now it starts to sound. */
    play(samples: Float32Array<ArrayBuffer>, sampleRate: number): number {
      const context = output();
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(context.currentTime + LEAD_SECONDS, next);
      next = startAt + buffer.duration + SENTENCE_PAUSE_SECONDS;
      playing.add(source);
      source.addEventListener("ended", () => {
        if (playing.delete(source) && playing.size === 0) onIdle();
      });
      source.start(startAt);
      return startAt - context.currentTime;
    },
    /** Silences at once. */
    stop(): void {
      const sources = [...playing];
      playing.clear();
      next = 0;
      for (const source of sources) {
        source.stop();
        source.disconnect();
      }
    },
  };
}
