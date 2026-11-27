import {
  createConversationLoop,
  type ConversationEnding,
  type ConversationHeard,
  type ConversationLoop,
  type ConversationNeed,
  type ConversationReply,
  type ConversationState,
  type SpeakableTextOptions,
} from "@t3tools/client-runtime/speaking";

/** The chat a conversation happens in: what its composer can do for it. */
export interface VoiceModeHost {
  setDraft(text: string): void;
  /** Sends the draft as a normal message; the message's id, or null when it was not sent. */
  send(): Promise<string | null>;
  /** Stops the assistant's turn on the server, if one is running. */
  stopTurn(): void;
}

export interface VoiceModePlatform {
  readonly ears: {
    /** Asks for the microphone; false when the user refused. */
    permit(): Promise<boolean>;
    listen(signal: AbortSignal): Promise<ConversationHeard>;
    sendNow(): void;
  };
  readonly mouth: {
    /** Loads the voice; the returned function lets it go. */
    hold(): Promise<() => void>;
    /** Queues one sentence and returns the number its `onSentence` call carries. */
    speak(sentence: string, lang: string): number;
    stop(): void;
    onDrained(callback: () => void): () => void;
    onSentence(callback: (id: number) => void): () => void;
  };
  /** One audio session for the whole conversation; null when it could not be had. */
  readonly takeAudio: (onTaken: () => void) => Promise<(() => void) | null>;
  /** Follows the answer to one message of a chat; returns its unsubscribe. */
  readonly watchTurn: (
    chatKey: string,
    messageId: string,
    reply: ConversationReply,
    onAnswered: () => void,
  ) => () => void;
  /** Marks the chat's next message as spoken; the returned function unmarks it. */
  readonly armSpokenReply: (chatKey: string) => () => void;
  readonly cue: (kind: "sent" | "thinking") => void;
  readonly pulse: (tick: () => void) => () => void;
  readonly language: (text: string) => string;
  /** One sentence said aloud for a state the user must know about, in a language near `lang`. */
  readonly phrase: (
    kind: ConversationNeed | "connection-lost",
    lang: string,
  ) => { readonly text: string; readonly lang: string };
  readonly speakable: () => SpeakableTextOptions;
  /** With a screen reader on, announces the conversation and waits for it to finish. */
  readonly settle: () => Promise<void>;
  readonly keepAwake: () => () => void;
  /** Calls back when a call or another app takes the audio, or the app leaves the screen. */
  readonly onTakenAway: (callback: () => void) => () => void;
  readonly onHeadsetButton: (callback: () => void) => () => void;
  /** Tells the user the conversation stopped: the microphone was refused, or something failed. */
  readonly reportError: (reason: "microphone" | "failed", error?: unknown) => void;
  readonly setTimer: (callback: () => void, ms: number) => () => void;
}

export interface VoiceModeSnapshot {
  /** The chat the conversation is in; null when there is none. */
  readonly chatKey: string | null;
  readonly state: ConversationState | "starting";
  readonly line: { readonly who: "you" | "assistant"; readonly text: string } | null;
}

interface Session {
  readonly chatKey: string;
  loop: ConversationLoop | null;
  need: ConversationNeed | null;
  readonly cleanup: Array<() => void>;
  unwatch: (() => void) | null;
  cancelLeave: (() => void) | null;
}

const IDLE: VoiceModeSnapshot = { chatKey: null, state: "idle", line: null };
/** A new chat's first message replaces its screen; the conversation outlives that. */
const LEFT_CHAT_AFTER_MS = 1_500;
/** How long the last sentence may take to finish before the audio is given back. */
const LAST_WORDS_MS = 12_000;

export function createVoiceModeRuntime(platform: VoiceModePlatform) {
  const listeners = new Set<() => void>();
  const hosts = new Map<string, VoiceModeHost>();
  let snapshot = IDLE;
  let session: Session | null = null;

  const publish = (next: VoiceModeSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const teardown = (own: Session, ending: ConversationEnding | null) => {
    if (session !== own) return;
    session = null;
    own.unwatch?.();
    own.cancelLeave?.();
    const release = () => {
      for (const step of own.cleanup.splice(0).reverse()) step();
    };
    // "Connection lost" is still being said; the audio goes back once it has been.
    if (ending?.reason === "connection-lost") {
      let released = false;
      const once = () => {
        if (released) return;
        released = true;
        stopWaiting();
        cancelTimer();
        release();
      };
      const stopWaiting = platform.mouth.onDrained(once);
      const cancelTimer = platform.setTimer(once, LAST_WORDS_MS);
    } else {
      platform.mouth.stop();
      release();
    }
    if (ending?.unsentText) hosts.get(own.chatKey)?.setDraft(ending.unsentText);
    if (ending?.reason === "failed") platform.reportError("failed", ending.error);
    publish(IDLE);
  };

  const close = () => {
    const own = session;
    if (!own) return;
    if (own.loop) own.loop.end();
    else teardown(own, null);
  };

  const begin = (own: Session) => {
    let spoken = "";
    let lang = platform.language("");
    const sentences = new Map<number, string>();
    own.cleanup.push(
      platform.mouth.onSentence((id) => {
        const text = sentences.get(id);
        sentences.delete(id);
        if (text !== undefined && session === own) {
          publish({ ...snapshot, line: { who: "assistant", text } });
        }
      }),
    );
    const say = (text: string, language: string) => {
      sentences.set(platform.mouth.speak(text, language), text);
    };
    const loop = createConversationLoop({
      ears: {
        listen: async (signal) => {
          const heard = await platform.ears.listen(signal);
          if ("text" in heard && heard.text.trim() !== "" && session === own) {
            publish({ ...snapshot, line: { who: "you", text: heard.text.trim() } });
          }
          return heard;
        },
      },
      chat: {
        send: async (text, reply) => {
          const host = hosts.get(own.chatKey);
          if (!host) throw new Error("The chat is no longer open.");
          spoken = "";
          host.setDraft(text);
          const disarm = platform.armSpokenReply(own.chatKey);
          let messageId: string | null;
          try {
            messageId = await host.send();
          } finally {
            disarm();
          }
          if (messageId === null) throw new Error("The message could not be sent.");
          if (session !== own) return;
          own.unwatch?.();
          own.unwatch = platform.watchTurn(
            own.chatKey,
            messageId,
            {
              ...reply,
              onNeedsUser: (kind) => {
                own.need = kind;
                reply.onNeedsUser(kind);
              },
            },
            () => loop.resume(),
          );
        },
      },
      mouth: {
        speak: (sentence) => {
          spoken += ` ${sentence}`;
          lang = platform.language(spoken);
          say(sentence, lang);
        },
        stop: () => {
          sentences.clear();
          platform.mouth.stop();
        },
        onDrained: platform.mouth.onDrained,
      },
      cue: (kind) => {
        if (kind === "sent" || kind === "thinking") return platform.cue(kind);
        const phrase = platform.phrase(
          kind === "needs-you" ? (own.need ?? "approval") : "connection-lost",
          lang,
        );
        say(phrase.text, phrase.lang);
      },
      pulse: platform.pulse,
      speakable: platform.speakable(),
      onEnded: (ending) => teardown(own, ending),
    });
    own.loop = loop;
    own.cleanup.push(
      loop.subscribe((state) => {
        if (session === own && state !== "ended") publish({ ...snapshot, state });
      }),
    );
    loop.start();
  };

  const interrupt = () => {
    const own = session;
    const state = own?.loop?.getState();
    if (!own || (state !== "thinking" && state !== "speaking")) return;
    own.unwatch?.();
    own.unwatch = null;
    own.loop?.interrupt();
    hosts.get(own.chatKey)?.stopTurn();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** A chat's composer is on screen; the returned function says it left. */
    attach(chatKey: string, host: VoiceModeHost): () => void {
      hosts.set(chatKey, host);
      if (session?.chatKey === chatKey) {
        session.cancelLeave?.();
        session.cancelLeave = null;
      }
      return () => {
        if (hosts.get(chatKey) !== host) return;
        hosts.delete(chatKey);
        const own = session;
        if (own?.chatKey !== chatKey) return;
        own.cancelLeave?.();
        own.cancelLeave = platform.setTimer(() => {
          if (session === own && !hosts.has(chatKey)) close();
        }, LEFT_CHAT_AFTER_MS);
      };
    },
    /** Starts a conversation in a chat that is on screen. */
    async open(chatKey: string): Promise<void> {
      if (session || !hosts.has(chatKey)) return;
      const own: Session = {
        chatKey,
        loop: null,
        need: null,
        cleanup: [],
        unwatch: null,
        cancelLeave: null,
      };
      session = own;
      publish({ chatKey, state: "starting", line: null });
      const live = () => session === own;
      try {
        if (!(await platform.ears.permit())) {
          if (live()) {
            teardown(own, null);
            platform.reportError("microphone");
          }
          return;
        }
        if (!live()) return;
        const release = await platform.takeAudio(close);
        if (!release) throw new Error("The audio is in use.");
        own.cleanup.push(release);
        if (!live()) return release();
        const letGo = await platform.mouth.hold();
        own.cleanup.push(letGo);
        if (!live()) return letGo();
        await platform.settle();
        if (!live()) return;
        own.cleanup.push(
          platform.keepAwake(),
          platform.onTakenAway(close),
          platform.onHeadsetButton(interrupt),
        );
        begin(own);
      } catch (error) {
        if (!live()) return;
        teardown(own, null);
        platform.reportError("failed", error);
      }
    },
    close,
    interrupt,
    sendNow: () => platform.ears.sendNow(),
  };
}

export type VoiceModeRuntime = ReturnType<typeof createVoiceModeRuntime>;
