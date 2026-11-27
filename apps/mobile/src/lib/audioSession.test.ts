import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const audio = vi.hoisted(() => ({ calls: [] as Array<string> }));

vi.mock("expo-audio", () => ({
  AudioModule: {
    setAudioSessionOwner: (owned: boolean) => void audio.calls.push(`owner ${owned}`),
  },
  setAudioModeAsync: async (mode: { allowsRecording?: boolean }) =>
    void audio.calls.push(`mode recording=${mode.allowsRecording}`),
  setIsAudioActiveAsync: async (active: boolean) => void audio.calls.push(`active ${active}`),
}));

import {
  acquireAudioSession,
  activateAudioSession,
  isAudioSessionOwner,
  releaseAudioSession,
} from "./audioSession";

beforeEach(() => {
  audio.calls.length = 0;
});

describe("the conversation's audio session", () => {
  it("plays and records from one activation until it is released", async () => {
    const conversation = acquireAudioSession("conversation");
    expect(await activateAudioSession(conversation)).toBe(true);
    expect(audio.calls).toEqual(["owner true", "mode recording=true", "active true"]);

    audio.calls.length = 0;
    await releaseAudioSession(conversation);
    expect(audio.calls).toEqual(["mode recording=false", "active false", "owner false"]);
  });

  it("stops a reply being read aloud when it starts", async () => {
    const stopped = vi.fn();
    const reading = acquireAudioSession("playback", stopped);
    const conversation = acquireAudioSession("conversation");
    expect(stopped).toHaveBeenCalledOnce();
    expect(isAudioSessionOwner(reading)).toBe(false);
    expect(isAudioSessionOwner(conversation)).toBe(true);
    await releaseAudioSession(conversation);
  });

  it("is not taken by a reply asked to be read aloud", async () => {
    const ended = vi.fn();
    const conversation = acquireAudioSession("conversation", ended);
    const reading = acquireAudioSession("playback");
    expect(isAudioSessionOwner(reading)).toBe(false);
    expect(await activateAudioSession(reading)).toBe(false);
    expect(isAudioSessionOwner(conversation)).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    await releaseAudioSession(conversation);
  });

  it("ends when dictation takes the microphone, and leaves the session to it", async () => {
    const ended = vi.fn();
    const conversation = acquireAudioSession("conversation", ended);
    await activateAudioSession(conversation);
    const dictation = acquireAudioSession("recording");
    expect(ended).toHaveBeenCalledOnce();

    audio.calls.length = 0;
    await releaseAudioSession(conversation);
    // The session is dictation's now: releasing the conversation must not switch it off.
    expect(audio.calls).toEqual([]);
    expect(isAudioSessionOwner(dictation)).toBe(true);
    await releaseAudioSession(dictation);
  });
});
