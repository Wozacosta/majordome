import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { createBrowserPcmCapture } from "~/speech/browserPcmCapture";

import { createConversationEars } from "./conversationEars";

/** A microphone that hears a voice-loud tone for `speechMs`, then a quiet room. */
function fakeMicrophone(context: AudioContext, speechMs: number): MediaStream {
  const tone = context.createOscillator();
  const level = context.createGain();
  const output = context.createMediaStreamDestination();
  tone.frequency.value = 220;
  level.gain.setValueAtTime(0.2, context.currentTime);
  level.gain.setValueAtTime(0, context.currentTime + speechMs / 1000);
  tone.connect(level);
  level.connect(output);
  tone.start();
  return output.stream;
}

it("hears turn after turn through the real capture, with no click between them", async () => {
  // The one gesture a conversation has: the click that started it.
  const start = document.body.appendChild(document.createElement("button"));
  await userEvent.click(start);
  start.remove();
  const context = new AudioContext();
  using microphone = vi
    .spyOn(navigator.mediaDevices, "getUserMedia")
    .mockImplementation(async () => fakeMicrophone(context, 1500));
  const recordings: number[] = [];
  const ears = createConversationEars({
    open: (events) =>
      createBrowserPcmCapture({ getMicrophoneId: () => "", ...events }, async () => ({
        locale: "en",
        transcribe: async (uri) => {
          const pcm = await (await fetch(uri)).arrayBuffer();
          recordings.push(pcm.byteLength);
          return `turn ${recordings.length}`;
        },
      })),
    // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- the turn is timed against real audio, on the browser's own clock
    now: () => performance.now(),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    // Shorter than in the app, so two turns fit in a test.
    endOfTurn: { quietMs: 600 },
  });

  try {
    // The turn ends by itself: the capture's own meter saw the tone, then the quiet after it.
    expect(await ears.listen(new AbortController().signal)).toEqual({ text: "turn 1" });
    // Listening again opens the microphone and a new audio graph without a new gesture.
    expect(await ears.listen(new AbortController().signal)).toEqual({ text: "turn 2" });
    expect(microphone).toHaveBeenCalledTimes(2);
    // At least 0.9 s of 16 kHz samples each: the tone and the quiet that ended the turn.
    for (const bytes of recordings) expect(bytes).toBeGreaterThan(16_000 * 4 * 0.9);
  } finally {
    await context.close();
  }
});
