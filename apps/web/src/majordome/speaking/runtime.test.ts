import type { VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import type { VoiceFiles } from "@t3tools/client-runtime/speaking/voice-store";
import { describe, expect, it } from "vite-plus/test";

import type { SpeechEngine } from "./engine";
import { readAloudReplyKey, voiceSampleKey } from "./keys";
import { createReadAloudRuntime } from "./runtime";

const catalog: VoiceCatalog = {
  id: "test-1",
  name: "Test",
  baseUrl: "https://voices.test",
  license: "openrail-m",
  copyright: "",
  languages: ["en", "fr"],
  files: [{ name: "voice.bin", size: 5, sha256: "right" }],
};

const REPLY = [
  "Voici le plan pour demain.",
  "",
  "```ts",
  "const secret = 42;",
  "```",
  "",
  "Nous irons au marché, puis nous rentrerons pour le déjeuner avec les enfants.",
].join("\n");

/** An engine that plays nothing and records what it was asked to say. */
function fakeEngine() {
  const said: Array<{ text: string; voice: number; lang: string }> = [];
  const calls: string[] = [];
  const drained = new Set<() => void>();
  const failed = new Set<(message: string) => void>();
  const sounding = new Set<(value: boolean) => void>();
  const engine: SpeechEngine = {
    prepare: async () => void calls.push("prepare"),
    speak: (text, options) => {
      said.push({ text, ...options });
      for (const listener of sounding) listener(true);
    },
    stop: () => {
      calls.push("stop");
      for (const listener of sounding) listener(false);
    },
    end: () => void calls.push("end"),
    onDrained: (listener) => {
      drained.add(listener);
      return () => drained.delete(listener);
    },
    onError: (listener) => {
      failed.add(listener);
      return () => failed.delete(listener);
    },
    onSounding: (listener) => {
      sounding.add(listener);
      return () => sounding.delete(listener);
    },
  };
  return {
    engine,
    said,
    calls,
    finish: () => {
      for (const listener of sounding) listener(false);
      for (const listener of drained) listener();
    },
    fail: (message: string) => {
      for (const listener of failed) listener(message);
    },
  };
}

function setup(options: { installed?: boolean; served?: string } = {}) {
  const disk = new Map<string, string>(options.installed === false ? [] : [["voice.bin", "right"]]);
  let served = options.served ?? "right";
  const files: VoiceFiles = {
    size: async (name) => disk.get(name)?.length ?? null,
    sha256: async (name) => disk.get(name) ?? "",
    fetchInto: async ({ name, onBytes }) => {
      disk.set(name, served);
      onBytes(served.length);
      return { status: 200 };
    },
    rename: async (from, to) => {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    remove: async (name) => void disk.delete(name),
  };
  const fake = fakeEngine();
  const audio: string[] = [];
  const errors: number[] = [];
  const dictation = new Set<() => void>();
  let stored = 0;
  let leftovers = 0;
  const runtime = createReadAloudRuntime({
    catalog,
    files,
    engine: fake.engine,
    wakeAudio: () => void audio.push("wake"),
    restAudio: () => void audio.push("rest"),
    onDictationStarted: (listener) => {
      dictation.add(listener);
      return () => dictation.delete(listener);
    },
    voiceCount: async () => 10,
    removeLeftovers: async () => void (leftovers += 1),
    reportError: () => void errors.push(1),
    placeholders: () => ({
      codeLine: "Il y a du code à l'écran.",
      tableLine: "Il y a un tableau à l'écran.",
      linkWord: "un lien",
    }),
    appLanguage: () => "en",
    readVoice: () => stored,
    writeVoice: (voice) => void (stored = voice),
  });
  const chat = "env:thread-1";
  const reply = (id: string, markdown = REPLY, at = "2026-11-27T10:00:00Z") => ({
    key: readAloudReplyKey(chat, id),
    chat,
    markdown,
    at,
  });
  return {
    runtime,
    ...fake,
    audio,
    errors,
    disk,
    chat,
    reply,
    serve: (text: string) => (served = text),
    dictate: () => {
      for (const listener of dictation) listener();
    },
    stored: () => stored,
    leftovers: () => leftovers,
  };
}

/** Lets the promise chains already started run to their end; nothing here waits on a clock. */
const settled = async () => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
};

describe("read aloud in the window", () => {
  it("says the reply's prose, not its code, in the reply's language", async () => {
    const { runtime, said, reply, chat, audio } = setup();
    const first = reply("m1");
    await runtime.toggle(first, chat);
    expect(said.map((sentence) => sentence.text)).toEqual([
      "Voici le plan pour demain.",
      "Il y a du code à l'écran.",
      "Nous irons au marché, puis nous rentrerons pour le déjeuner avec les enfants.",
    ]);
    expect(said.every((sentence) => sentence.lang === "fr" && sentence.voice === 0)).toBe(true);
    expect(said.some((sentence) => sentence.text.includes("secret"))).toBe(false);
    expect(runtime.controller.isActive(first.key)).toBe(true);
    expect(runtime.sounding.get()).toBe(true);
    // The audio output is started inside the click that asked for sound.
    expect(audio).toEqual(["wake"]);
  });

  it("stops on a second press, and rests the audio output", async () => {
    const { runtime, calls, reply, chat, audio } = setup();
    const first = reply("m1");
    await runtime.toggle(first, chat);
    await runtime.toggle(first, chat);
    expect(calls).toEqual(["prepare", "stop"]);
    expect(runtime.controller.getState()).toEqual({ status: "idle" });
    expect(runtime.sounding.get()).toBe(false);
    expect(audio).toEqual(["wake", "rest"]);
  });

  it("reads one reply at a time, and leaves the output awake for the second", async () => {
    const { runtime, calls, said, reply, chat, audio } = setup();
    await runtime.toggle(reply("m1"), chat);
    const second = reply("m2", "A short answer in English, with the words it needs.");
    await runtime.toggle(second, chat);
    expect(calls).toEqual(["prepare", "stop", "prepare"]);
    expect(runtime.controller.isActive(second.key)).toBe(true);
    expect(said.at(-1)).toMatchObject({ lang: "en" });
    expect(audio.at(-1)).toBe("wake");
  });

  it("returns to rest when the reply has been read", async () => {
    const { runtime, finish, reply, chat } = setup();
    const first = reply("m1");
    await runtime.toggle(first, chat);
    finish();
    expect(runtime.controller.isActive(first.key)).toBe(false);
    expect(runtime.sounding.get()).toBe(false);
  });

  it("stops when dictation opens the microphone", async () => {
    const { runtime, calls, dictate, reply, chat } = setup();
    await runtime.toggle(reply("m1"), chat);
    dictate();
    expect(calls).toEqual(["prepare", "stop"]);
    expect(runtime.controller.getState()).toEqual({ status: "idle" });
  });

  it("stops when the chat is left: another page, and none of its replies on screen", async () => {
    const { runtime, calls, reply, chat } = setup();
    runtime.showChat(chat);
    const first = reply("m1");
    const hide = runtime.replies.show(first);
    await runtime.toggle(first, chat);

    // Scrolling the reply's own button away is not leaving.
    hide();
    await settled();
    expect(calls).toEqual(["prepare"]);

    runtime.showChat("env:thread-2");
    await settled();
    expect(calls).toEqual(["prepare", "stop"]);
  });

  it("keeps reading the assistant beside a page while its replies are on screen", async () => {
    const { runtime, calls, reply, chat } = setup();
    runtime.showChat(null);
    const first = reply("m1");
    const hide = runtime.replies.show(first);
    await runtime.toggle(first, chat);
    runtime.showChat(null);
    await settled();
    expect(calls).toEqual(["prepare"]);
    hide();
    await settled();
    expect(calls).toEqual(["prepare", "stop"]);
  });

  it("answers the shortcut with the newest reply on screen, then with stop", async () => {
    const { runtime, said, calls, reply } = setup();
    await runtime.toggleLatest();
    expect(calls).toEqual([]);
    runtime.replies.show(
      reply("m1", "The older answer is here for you to hear.", "2026-11-27T10:00:00Z"),
    );
    runtime.replies.show(
      reply("m2", "The newer answer is the one that is read.", "2026-11-27T10:05:00Z"),
    );
    expect(runtime.replies.latest()?.key).toBe(reply("m2").key);
    await runtime.toggleLatest();
    expect(said.map((sentence) => sentence.text)).toEqual([
      "The newer answer is the one that is read.",
    ]);
    await runtime.toggleLatest();
    expect(calls).toEqual(["prepare", "stop"]);
  });

  it("offers the download instead of speaking, then reads the reply that asked", async () => {
    const { runtime, said, reply, chat, audio } = setup({ installed: false });
    const first = reply("m1");
    await runtime.toggle(first, chat);
    expect(said).toEqual([]);
    expect(runtime.downloadOffered.get()).toBe(true);
    expect(runtime.controller.getState()).toEqual({ status: "idle" });

    expect((await runtime.download()).status).toBe("ready");
    await settled();
    expect(runtime.downloadOffered.get()).toBe(false);
    expect(said).toHaveLength(3);
    expect(runtime.controller.isActive(first.key)).toBe(true);
    expect(audio.at(-1)).toBe("wake");
  });

  it("stays on the download when the checksum is wrong, and reads once it is right", async () => {
    const { runtime, said, reply, chat, serve, disk } = setup({
      installed: false,
      served: "wrong",
    });
    await runtime.toggle(reply("m1"), chat);
    expect(await runtime.download()).toEqual({ status: "failed", reason: "verification" });
    expect(runtime.downloadOffered.get()).toBe(true);
    expect(said).toEqual([]);
    expect([...disk.keys()]).toEqual([]);

    serve("right");
    expect((await runtime.download()).status).toBe("ready");
    await settled();
    expect(said).toHaveLength(3);
  });

  it("forgets the waiting reply when the download is dismissed", async () => {
    const { runtime, said, reply, chat } = setup({ installed: false });
    await runtime.toggle(reply("m1"), chat);
    runtime.dismissDownload();
    expect(runtime.downloadOffered.get()).toBe(false);
    runtime.offerDownload();
    await runtime.download();
    await settled();
    expect(said).toEqual([]);
  });

  it("samples a voice without changing the chosen one, and remembers a choice", async () => {
    const { runtime, said, stored } = setup();
    await runtime.toggle({
      key: voiceSampleKey(4),
      voice: 4,
      markdown: "Hello. This is how I sound.",
    });
    expect(said.map((sentence) => sentence.voice)).toEqual([4]);
    expect(runtime.voice.get()).toBe(0);
    runtime.voice.set(7);
    expect(stored()).toBe(7);
    expect(runtime.voice.get()).toBe(7);
    // A sample is not a chat's reply: changing page does not stop it.
    runtime.showChat("env:thread-9");
    await settled();
    expect(runtime.controller.getState().status).toBe("speaking");
  });

  it("removes the download: silence, the worker ended, every file gone", async () => {
    const { runtime, calls, disk, reply, chat, leftovers } = setup();
    await runtime.toggle(reply("m1"), chat);
    await runtime.remove();
    expect(calls).toEqual(["prepare", "stop", "end"]);
    expect([...disk.keys()]).toEqual([]);
    expect(leftovers()).toBe(1);
    expect(runtime.store.getState()).toEqual({ status: "absent" });
  });

  it("reports a failure once and returns to rest", async () => {
    const { runtime, fail, errors, reply, chat } = setup();
    await runtime.toggle(reply("m1"), chat);
    fail("out of memory");
    expect(errors).toEqual([1]);
    expect(runtime.controller.getState()).toEqual({ status: "idle" });
  });
});
