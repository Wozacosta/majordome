import { splitSentences, toSpeakableText } from "@t3tools/client-runtime/speaking";
import { pickSpeechLanguage } from "@t3tools/client-runtime/speaking/language";
import {
  ReadAloudController,
  type ReadAloudRequest,
} from "@t3tools/client-runtime/speaking/read-aloud";
import type { VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { createVoiceStore, type VoiceFiles } from "@t3tools/client-runtime/speaking/voice-store";

import type { SpeechEngine } from "./engine";

export interface ReadAloudPlatform {
  readonly catalog: VoiceCatalog;
  readonly files: VoiceFiles;
  readonly engine: SpeechEngine;
  /** Starts the audio output; called inside the click or key press that asks for sound. */
  readonly wakeAudio: () => void;
  /** Lets the audio output rest while nothing is read. */
  readonly restAudio: () => void;
  /** Plays a short sound on the audio output: a message was sent, or the assistant is still working. */
  readonly cue: (kind: "sent" | "thinking") => void;
  readonly onDictationStarted: (listener: () => void) => () => void;
  /** How many voices the downloaded voice file holds. */
  readonly voiceCount: () => Promise<number>;
  /** Removes what is left in the voice's storage beyond the catalog's own files. */
  readonly removeLeftovers: () => Promise<void>;
  readonly reportError: () => void;
  /** What is said in place of a code block, a table and a bare link, in the app's language. */
  readonly placeholders: () => {
    readonly codeLine: string;
    readonly tableLine: string;
    readonly linkWord: string;
  };
  readonly appLanguage: () => string;
  readonly readVoice: () => number;
  readonly writeVoice: (voice: number) => void;
}

/** A reply on screen that can be read: the newest one answers the shortcut. */
export interface ReadableReply extends ReadAloudRequest {
  /** The chat the reply is in. */
  readonly chat: string;
  /** When the reply was written, as an ISO time. */
  readonly at: string;
}

function createSignal<A>(initial: A) {
  const listeners = new Set<() => void>();
  let value = initial;
  return {
    get: () => value,
    set: (next: A) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Read aloud in the window: the voice's files, the reply being read, and the chosen voice. */
export function createReadAloudRuntime(platform: ReadAloudPlatform) {
  const { engine } = platform;
  const store = createVoiceStore(platform.catalog, platform.files);
  const voice = createSignal(platform.readVoice());
  const downloadOffered = createSignal(false);
  const sounding = createSignal(false);
  const replies = createSignal<ReadonlyArray<ReadableReply>>([]);
  let pending: ReadAloudRequest | null = null;
  /** What a conversation asked to do once the voice is on this computer. */
  let pendingAction: (() => void) | null = null;
  /** A conversation holds the voice and the audio output; `takenFromConversation` ends it. */
  let conversations = 0;
  let takenFromConversation: (() => void) | null = null;
  const restAudio = () => {
    if (conversations === 0) platform.restAudio();
  };

  const controller = new ReadAloudController({
    engine,
    voiceReady: async () => (await store.refresh()).status === "ready",
    offerDownload: (request) => {
      pending = request;
      downloadOffered.set(true);
    },
    takeAudio: async (onTaken) => platform.onDictationStarted(onTaken),
    sentences: (markdown) => splitSentences(toSpeakableText(markdown, platform.placeholders())),
    language: (text) =>
      pickSpeechLanguage(text, platform.appLanguage(), platform.catalog.languages),
    voice: voice.get,
    onError: platform.reportError,
  });
  engine.onSounding(sounding.set);
  controller.subscribe(() => {
    if (controller.getState().status === "idle") restAudio();
  });

  /** The chat of the reply being read; null for a voice sampled in Settings. */
  let readingChat: string | null = null;
  let shownChat: string | null = null;

  const toggle = (request: ReadAloudRequest, chat: string | null = null) => {
    const starting = !controller.isActive(request.key);
    // One voice: reading a reply ends the conversation that was using it.
    if (starting) takenFromConversation?.();
    const done = controller.toggle(request);
    if (starting) {
      readingChat = chat;
      // After the toggle: starting stops the reply before it, which rests the output.
      platform.wakeAudio();
    }
    return done;
  };
  // A chat is left when it is neither the page's own nor has a reply on screen (the assistant
  // beside a page is not the page's chat; a long reply scrolls its own button away).
  const stopIfLeft = () =>
    queueMicrotask(() => {
      if (controller.getState().status === "idle" || readingChat === null) return;
      if (readingChat === shownChat) return;
      if (replies.get().some((reply) => reply.chat === readingChat)) return;
      controller.stop();
    });
  replies.subscribe(stopIfLeft);
  const latest = () =>
    replies
      .get()
      .reduce<ReadableReply | null>(
        (newest, reply) => (newest === null || reply.at >= newest.at ? reply : newest),
        null,
      );

  return {
    catalog: platform.catalog,
    store,
    controller,
    /** Reads the reply, or stops it when it is the one being read. Call from a click or key press. */
    toggle,
    /** Whether sound has started for the reply being read; until then it is being prepared. */
    sounding,
    downloadOffered,
    /** Shows the download without a reply waiting for it. */
    offerDownload: () => downloadOffered.set(true),
    /** Downloads the voice, then reads the reply that asked for it. */
    download: async () => {
      // The click that starts a download is the one that allows the reply's sound.
      if (pending || pendingAction) platform.wakeAudio();
      const state = await store.download();
      const request = pending;
      const action = pendingAction;
      // A failed download can be tried again from the same dialog, for the same reply.
      if (state.status !== "failed") {
        pending = null;
        pendingAction = null;
      }
      if (state.status === "ready") {
        downloadOffered.set(false);
        if (request) void controller.start(request);
        action?.();
      }
      return state;
    },
    /** The dialog closed: stops the download, keeps what arrived, forgets the waiting reply. */
    dismissDownload: () => {
      pending = null;
      pendingAction = null;
      store.cancel();
      downloadOffered.set(false);
      if (controller.getState().status === "idle") restAudio();
    },
    remove: async () => {
      controller.stop();
      engine.end();
      await store.remove();
      await platform.removeLeftovers();
    },
    voiceCount: platform.voiceCount,
    /** Talking with the assistant: the voice says sentences as they arrive, turn after turn. */
    conversation: {
      /**
       * Runs `action` with the voice on this computer, offering the download first when it is
       * not. Call from a click or key press: it is what allows the sound.
       */
      whenVoiceReady: async (action: () => void) => {
        platform.wakeAudio();
        if ((await store.refresh()).status === "ready") return action();
        pending = null;
        pendingAction = action;
        downloadOffered.set(true);
      },
      /**
       * Loads the voice and keeps it and the audio output until the returned function is
       * called. `onTaken` fires when a reply is asked to be read instead.
       */
      hold: async (onTaken: () => void) => {
        conversations += 1;
        const letGo = engine.hold();
        let held = true;
        const release = () => {
          if (!held) return;
          held = false;
          conversations -= 1;
          if (takenFromConversation === onTaken) takenFromConversation = null;
          letGo();
          if (controller.getState().status === "idle") restAudio();
        };
        try {
          controller.stop();
          takenFromConversation = onTaken;
          platform.wakeAudio();
          await engine.prepare();
        } catch (error) {
          release();
          throw error;
        }
        return release;
      },
      speak: (sentence: string, lang: string) =>
        engine.speak(sentence, { voice: voice.get(), lang }),
      stop: engine.stop,
      onDrained: engine.onDrained,
      onSentence: engine.onSentence,
      onError: engine.onError,
      cue: platform.cue,
      languages: platform.catalog.languages,
      placeholders: platform.placeholders,
    },
    voice: {
      get: voice.get,
      subscribe: voice.subscribe,
      set: (next: number) => {
        voice.set(next);
        platform.writeVoice(next);
      },
    },
    replies: {
      subscribe: replies.subscribe,
      /** The newest reply on screen, or null when there is none. */
      latest,
      /** A reply came on screen; returns how to say it left. */
      show: (reply: ReadableReply) => {
        replies.set([...replies.get(), reply]);
        return () => replies.set(replies.get().filter((shown) => shown !== reply));
      },
    },
    /** Reads the newest reply on screen, or stops whatever is being read. */
    toggleLatest: (): Promise<void> => {
      if (controller.getState().status !== "idle") {
        controller.stop();
        return Promise.resolve();
      }
      const reply = latest();
      return reply ? toggle(reply, reply.chat) : Promise.resolve();
    },
    /** The chat the page shows changed; null when the page is not a chat. */
    showChat: (chat: string | null) => {
      shownChat = chat;
      stopIfLeft();
    },
  };
}

export type ReadAloudRuntime = ReturnType<typeof createReadAloudRuntime>;
