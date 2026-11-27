import { describe, expect, it } from "vite-plus/test";

import { createEndOfTurnDetector, type EndOfTurnDetector } from "./endOfTurn.ts";

const QUIET = -65;
const SPEECH = -18;

function feeder(detector: EndOfTurnDetector, stepMs = 80) {
  let atMs = 1_000_000;
  return {
    feed(db: number, durationMs: number) {
      let status = detector.push({ db, atMs });
      const until = atMs + durationMs;
      while (atMs < until) {
        atMs += stepMs;
        status = detector.push({ db, atMs });
      }
      return status;
    },
  };
}

describe("createEndOfTurnDetector", () => {
  it("ends after speech and then two seconds of quiet", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    expect(feed(QUIET, 800)).toBe("waiting");
    expect(feed(SPEECH, 1200)).toBe("speaking");
    expect(feed(QUIET, 1900)).toBe("speaking");
    expect(feed(QUIET, 160)).toBe("ended");
    expect(feed(SPEECH, 500)).toBe("ended");
  });

  it("keeps listening through pauses shorter than the quiet time", () => {
    const { feed } = feeder(createEndOfTurnDetector(), 50);

    feed(QUIET, 300);
    expect(feed(SPEECH, 700)).toBe("speaking");
    expect(feed(QUIET, 1500)).toBe("speaking");
    expect(feed(SPEECH, 400)).toBe("speaking");
    expect(feed(QUIET, 1500)).toBe("speaking");
    expect(feed(QUIET, 600)).toBe("ended");
  });

  it("does not take a click or a cough for speech", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    feed(QUIET, 500);
    expect(feed(SPEECH, 160)).toBe("waiting");
    expect(feed(QUIET, 4000)).toBe("waiting");
    expect(feed(SPEECH, 160)).toBe("waiting");
    expect(feed(QUIET, 4000)).toBe("waiting");
  });

  it("gives up after thirty seconds with nothing heard", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    expect(feed(QUIET, 29_900)).toBe("waiting");
    expect(feed(QUIET, 200)).toBe("gave-up");
    expect(feed(SPEECH, 2000)).toBe("gave-up");
  });

  it("does not give up once speech was heard", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    feed(QUIET, 29_000);
    expect(feed(SPEECH, 1500)).toBe("speaking");
    expect(feed(QUIET, 2100)).toBe("ended");
  });

  it("adapts to a noisy room", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    expect(feed(-36, 5000)).toBe("waiting");
    expect(feed(-12, 1000)).toBe("speaking");
    expect(feed(-36, 2100)).toBe("ended");
  });

  it("gives up in a noisy room where nobody speaks", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    expect(feed(-37, 30_100)).toBe("gave-up");
  });

  it("hears someone who is already speaking at the first sample", () => {
    const { feed } = feeder(createEndOfTurnDetector());

    expect(feed(SPEECH, 1000)).toBe("speaking");
    expect(feed(QUIET, 2100)).toBe("ended");
  });

  it("honours its options", () => {
    const { feed } = feeder(
      createEndOfTurnDetector({ speechDb: -20, quietMs: 500, minSpeechMs: 100, giveUpMs: 2000 }),
    );

    expect(feed(-30, 1000)).toBe("waiting");
    expect(feed(-15, 160)).toBe("speaking");
    expect(feed(-30, 400)).toBe("speaking");
    expect(feed(-30, 160)).toBe("ended");

    const second = feeder(createEndOfTurnDetector({ giveUpMs: 2000 }));
    expect(second.feed(QUIET, 2000)).toBe("gave-up");
  });

  it("starts over after a reset, with time taken from the samples", () => {
    const detector = createEndOfTurnDetector();
    const first = feeder(detector);
    first.feed(QUIET, 200);
    first.feed(SPEECH, 1000);
    expect(first.feed(QUIET, 2100)).toBe("ended");

    detector.reset();
    const second = feeder(detector);
    expect(second.feed(QUIET, 29_000)).toBe("waiting");
    expect(second.feed(QUIET, 1100)).toBe("gave-up");
  });

  it("does not count a long gap between samples as speech", () => {
    const detector = createEndOfTurnDetector();

    expect(detector.push({ db: QUIET, atMs: 0 })).toBe("waiting");
    expect(detector.push({ db: SPEECH, atMs: 5000 })).toBe("waiting");
    expect(detector.push({ db: Number.NEGATIVE_INFINITY, atMs: 5080 })).toBe("waiting");
  });
});
