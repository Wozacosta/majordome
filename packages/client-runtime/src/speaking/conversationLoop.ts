import { createSentenceStream, type SentenceStream } from "./sentenceStream.ts";
import type { SpeakableTextOptions } from "./speakableText.ts";

export type ConversationState =
  | "idle"
  | "listening"
  | "sending"
  | "thinking"
  | "speaking"
  | "needs-you"
  | "ended";

export type ConversationCue = "sent" | "thinking" | "needs-you" | "connection-lost";

export type ConversationNeed = "approval" | "question";

export type ConversationHeard = { readonly text: string } | { readonly gaveUp: true };

export interface ConversationReply {
  onReplyText(cumulativeMarkdown: string): void;
  onReplyDone(): void;
  onNeedsUser(kind: ConversationNeed): void;
  onConnectionLost(): void;
}

export interface ConversationEnding {
  readonly reason: "closed" | "gave-up" | "connection-lost" | "failed";
  readonly unsentText: string | null;
  readonly error?: unknown;
}

export interface ConversationLoopDeps {
  readonly ears: {
    listen(signal: AbortSignal): Promise<ConversationHeard>;
  };
  readonly chat: {
    /** Resolves once the message is accepted. `reply` receives only this message's answer. */
    send(text: string, reply: ConversationReply): Promise<void>;
  };
  readonly mouth: {
    speak(sentence: string): void;
    stop(): void;
    /** Fires each time everything queued has been spoken. Returns its unsubscribe. */
    onDrained(callback: () => void): () => void;
  };
  cue(kind: ConversationCue): void;
  /** Calls `tick` at the thinking pulse's pace until the returned function is called. */
  readonly pulse?: (tick: () => void) => () => void;
  readonly onEnded?: (ending: ConversationEnding) => void;
  readonly speakable?: SpeakableTextOptions;
}

export interface ConversationLoop {
  start(): void;
  interrupt(): void;
  resume(): void;
  end(): ConversationEnding;
  getState(): ConversationState;
  subscribe(listener: (state: ConversationState) => void): () => void;
}

export function createConversationLoop(deps: ConversationLoopDeps): ConversationLoop {
  const listeners = new Set<(state: ConversationState) => void>();
  let state: ConversationState = "idle";
  let turn = 0;
  let ending: ConversationEnding | null = null;
  let listenAbort: AbortController | null = null;
  let stopPulse: (() => void) | null = null;
  let stopDrained: (() => void) | null = null;

  let unsentText: string | null = null;
  let stream: SentenceStream = createSentenceStream(deps.speakable);
  let replyLength = 0;
  let replyDone = false;
  let connectionLost = false;
  let mouthBusy = false;

  const setState = (next: ConversationState) => {
    if (state === next) return;
    state = next;
    stopPulse?.();
    stopPulse = next === "thinking" && deps.pulse ? deps.pulse(() => deps.cue("thinking")) : null;
    for (const listener of listeners) listener(next);
  };

  const finish = (reason: ConversationEnding["reason"], error?: unknown): ConversationEnding => {
    if (ending) return ending;
    turn += 1;
    listenAbort?.abort();
    listenAbort = null;
    if (reason !== "connection-lost") deps.mouth.stop();
    stopDrained?.();
    stopDrained = null;
    mouthBusy = false;
    ending = error === undefined ? { reason, unsentText } : { reason, unsentText, error };
    unsentText = null;
    setState("ended");
    deps.onEnded?.(ending);
    return ending;
  };

  const say = (sentences: ReadonlyArray<string>) => {
    for (const sentence of sentences) {
      mouthBusy = true;
      deps.mouth.speak(sentence);
    }
  };

  const markSent = () => {
    if (unsentText === null) return;
    unsentText = null;
    deps.cue("sent");
  };

  const settle = (leaveNeedsYou = false) => {
    if (state === "ended" || (state === "needs-you" && !leaveNeedsYou)) return;
    if (mouthBusy) setState("speaking");
    else if (connectionLost) {
      deps.cue("connection-lost");
      finish("connection-lost");
    } else if (replyDone) listen();
    else setState("thinking");
  };

  const reply = (ownTurn: number): ConversationReply => {
    const live = () => ownTurn === turn && state !== "listening" && state !== "ended";
    return {
      onReplyText(cumulativeMarkdown) {
        if (!live() || replyDone || connectionLost) return;
        if (cumulativeMarkdown.length <= replyLength) return;
        markSent();
        const added = cumulativeMarkdown.slice(replyLength);
        replyLength = cumulativeMarkdown.length;
        say(stream.push(added));
        settle();
      },
      onReplyDone() {
        if (!live() || replyDone || connectionLost) return;
        markSent();
        replyDone = true;
        say(stream.flush());
        settle();
      },
      onNeedsUser() {
        if (!live() || replyDone || connectionLost || state === "needs-you") return;
        markSent();
        deps.cue("needs-you");
        setState("needs-you");
      },
      onConnectionLost() {
        if (!live() || replyDone || connectionLost) return;
        connectionLost = true;
        say(stream.flush());
        settle(true);
      },
    };
  };

  const send = (text: string) => {
    const ownTurn = turn;
    unsentText = text;
    stream = createSentenceStream(deps.speakable);
    replyLength = 0;
    replyDone = false;
    connectionLost = false;
    setState("sending");
    deps.chat.send(text, reply(ownTurn)).then(
      () => {
        if (ownTurn !== turn || state !== "sending") return;
        markSent();
        settle();
      },
      (error: unknown) => {
        if (ownTurn !== turn || unsentText === null) return;
        finish("failed", error);
      },
    );
  };

  function listen() {
    turn += 1;
    const ownTurn = turn;
    listenAbort?.abort();
    const abort = new AbortController();
    listenAbort = abort;
    setState("listening");
    deps.ears.listen(abort.signal).then(
      (heard) => {
        if (ownTurn !== turn || abort.signal.aborted) return;
        listenAbort = null;
        if ("gaveUp" in heard) {
          finish("gave-up");
          return;
        }
        const text = heard.text.trim();
        if (text === "") listen();
        else send(text);
      },
      (error: unknown) => {
        if (ownTurn !== turn || abort.signal.aborted) return;
        finish("failed", error);
      },
    );
  }

  return {
    start() {
      if (state !== "idle") return;
      stopDrained = deps.mouth.onDrained(() => {
        mouthBusy = false;
        if (state === "speaking") settle();
      });
      listen();
    },
    interrupt() {
      if (state !== "thinking" && state !== "speaking") return;
      deps.mouth.stop();
      mouthBusy = false;
      if (connectionLost) settle();
      else listen();
    },
    resume() {
      if (state !== "needs-you") return;
      settle(true);
    },
    end() {
      return finish("closed");
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
