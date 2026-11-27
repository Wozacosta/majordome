/** As much of an AudioContext as a cue needs. */
export interface CueOutput {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

const CUES = {
  // One soft tick: the message left.
  sent: { hertz: 880, seconds: 0.09, peak: 0.07 },
  // A lower, quieter pulse: the assistant is still working.
  thinking: { hertz: 440, seconds: 0.16, peak: 0.035 },
} as const;

/** A short sine with a fast attack and a decay to silence, so it neither clicks nor rings. */
export function playCue(output: CueOutput, kind: keyof typeof CUES): void {
  const { hertz, seconds, peak } = CUES[kind];
  try {
    const at = output.currentTime;
    const tone = output.createOscillator();
    const level = output.createGain();
    tone.type = "sine";
    tone.frequency.value = hertz;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(peak, at + 0.01);
    level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    tone.connect(level);
    level.connect(output.destination);
    tone.addEventListener("ended", () => level.disconnect(), { once: true });
    tone.start(at);
    tone.stop(at + seconds + 0.02);
  } catch {}
}
