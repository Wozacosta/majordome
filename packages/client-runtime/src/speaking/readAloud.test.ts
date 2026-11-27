import { describe, expect, it } from "vite-plus/test";

import {
  ReadAloudController,
  type ReadAloudDependencies,
  type ReadAloudRequest,
} from "./readAloud.ts";

function harness(overrides: Partial<ReadAloudDependencies> = {}) {
  const spoken: Array<{ text: string; voice: number; lang: string }> = [];
  const offered: ReadAloudRequest[] = [];
  const errors: string[] = [];
  let drained = () => {};
  let failed = (_message: string) => {};
  let taken = () => {};
  const counts = { stops: 0, releases: 0, prepares: 0 };
  const controller = new ReadAloudController({
    engine: {
      prepare: async () => void (counts.prepares += 1),
      speak: (text, options) => spoken.push({ text, ...options }),
      stop: () => void (counts.stops += 1),
      onDrained: (listener) => {
        drained = listener;
        return () => {};
      },
      onError: (listener) => {
        failed = listener;
        return () => {};
      },
    },
    voiceReady: async () => true,
    offerDownload: (request) => offered.push(request),
    takeAudio: async (onTaken) => {
      taken = onTaken;
      return () => void (counts.releases += 1);
    },
    sentences: (markdown) => markdown.split(". ").filter(Boolean),
    language: () => "fr",
    voice: () => 3,
    onError: (message) => errors.push(message),
    ...overrides,
  });
  return {
    controller,
    spoken,
    offered,
    errors,
    counts,
    drain: () => drained(),
    fail: (message: string) => failed(message),
    takeAway: () => taken(),
  };
}

const reply = { key: "m1", markdown: "Bonjour. Tout est prêt" };

describe("read aloud", () => {
  it("queues each sentence with the chosen voice and language", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    expect(h.spoken).toEqual([
      { text: "Bonjour", voice: 3, lang: "fr" },
      { text: "Tout est prêt", voice: 3, lang: "fr" },
    ]);
    expect(h.controller.getState()).toEqual({ status: "speaking", key: "m1" });
    expect(h.controller.isActive("m1")).toBe(true);
    expect(h.controller.isActive("m2")).toBe(false);
  });

  it("stops when the same reply is asked again", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    await h.controller.toggle(reply);
    expect(h.counts).toMatchObject({ stops: 1, releases: 1 });
    expect(h.controller.getState()).toEqual({ status: "idle" });
  });

  it("stops the first reply when another is asked", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    await h.controller.toggle({ key: "m2", markdown: "Autre" });
    expect(h.counts.stops).toBe(1);
    expect(h.controller.getState()).toEqual({ status: "speaking", key: "m2" });
    expect(h.spoken.at(-1)?.text).toBe("Autre");
  });

  it("returns to idle and gives the audio back when the queue drains", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    h.drain();
    expect(h.controller.getState()).toEqual({ status: "idle" });
    expect(h.counts).toMatchObject({ stops: 0, releases: 1 });
  });

  it("stops when dictation takes the audio", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    h.takeAway();
    expect(h.counts.stops).toBe(1);
    expect(h.controller.getState()).toEqual({ status: "idle" });
  });

  it("does not speak while a recording holds the audio", async () => {
    const h = harness({ takeAudio: async () => null });
    await h.controller.toggle(reply);
    expect(h.spoken).toEqual([]);
    expect(h.controller.getState()).toEqual({ status: "idle" });
  });

  it("offers the download instead of speaking when the voice is absent", async () => {
    const h = harness({ voiceReady: async () => false });
    await h.controller.toggle(reply);
    expect(h.offered).toEqual([reply]);
    expect(h.spoken).toEqual([]);
    expect(h.counts.prepares).toBe(0);
    expect(h.controller.getState()).toEqual({ status: "idle" });
  });

  it("says nothing when a stop arrives while the voice loads", async () => {
    let loaded = () => {};
    const h = harness();
    const slow = harness({
      engine: {
        prepare: () => new Promise<void>((resolve) => (loaded = resolve)),
        speak: (text) => h.spoken.push({ text, voice: 0, lang: "" }),
        stop: () => {},
        onDrained: () => () => {},
        onError: () => () => {},
      },
    });
    const started = slow.controller.toggle(reply);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    slow.controller.stop();
    loaded();
    await started;
    expect(h.spoken).toEqual([]);
    expect(slow.controller.getState()).toEqual({ status: "idle" });
  });

  it("reports an engine failure and returns to idle", async () => {
    const h = harness();
    await h.controller.toggle(reply);
    h.fail("no sound");
    expect(h.errors).toEqual(["no sound"]);
    expect(h.controller.getState()).toEqual({ status: "idle" });
    expect(h.counts.releases).toBe(1);
  });

  it("stays idle for a reply with nothing to say", async () => {
    const h = harness();
    await h.controller.toggle({ key: "m3", markdown: "" });
    expect(h.spoken).toEqual([]);
    expect(h.controller.getState()).toEqual({ status: "idle" });
  });
});
