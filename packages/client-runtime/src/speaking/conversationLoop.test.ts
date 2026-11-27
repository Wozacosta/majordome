import { describe, expect, it } from "vite-plus/test";

import {
  createConversationLoop,
  type ConversationCue,
  type ConversationEnding,
  type ConversationHeard,
  type ConversationReply,
  type ConversationState,
} from "./conversationLoop.ts";

function setup() {
  const listens: { signal: AbortSignal; heard: PromiseWithResolvers<ConversationHeard> }[] = [];
  const sends: { text: string; reply: ConversationReply; sent: PromiseWithResolvers<void> }[] = [];
  const spoken: string[] = [];
  const cues: ConversationCue[] = [];
  const states: ConversationState[] = [];
  const endings: ConversationEnding[] = [];
  const mouth = { stops: 0, drained: null as (() => void) | null };
  const pulse = { tick: null as (() => void) | null };

  const loop = createConversationLoop({
    ears: {
      listen(signal) {
        const heard = Promise.withResolvers<ConversationHeard>();
        listens.push({ signal, heard });
        return heard.promise;
      },
    },
    chat: {
      send(text, reply) {
        const sent = Promise.withResolvers<void>();
        sends.push({ text, reply, sent });
        return sent.promise;
      },
    },
    mouth: {
      speak: (sentence) => void spoken.push(sentence),
      stop: () => void (mouth.stops += 1),
      onDrained(callback) {
        mouth.drained = callback;
        return () => {
          mouth.drained = null;
        };
      },
    },
    cue: (kind) => void cues.push(kind),
    pulse(tick) {
      pulse.tick = tick;
      return () => {
        pulse.tick = null;
      };
    },
    onEnded: (ending) => void endings.push(ending),
  });
  loop.subscribe((state) => void states.push(state));

  const hear = async (heard: ConversationHeard) => {
    const listening = listens.at(-1)!;
    listening.heard.resolve(heard);
    await listening.heard.promise;
  };
  const accept = async () => {
    const sending = sends.at(-1)!;
    sending.sent.resolve();
    await sending.sent.promise;
  };
  const ask = async (text: string) => {
    await hear({ text });
    await accept();
    return sends.at(-1)!.reply;
  };

  return { loop, listens, sends, spoken, cues, states, endings, mouth, pulse, hear, accept, ask };
}

describe("createConversationLoop", () => {
  it("listens, sends, speaks while the reply streams, then listens again", async () => {
    const t = setup();
    expect(t.loop.getState()).toBe("idle");

    t.loop.start();
    expect(t.loop.getState()).toBe("listening");

    await t.hear({ text: "  What is on today?  " });
    expect(t.loop.getState()).toBe("sending");
    expect(t.sends.map((send) => send.text)).toEqual(["What is on today?"]);
    expect(t.cues).toEqual([]);

    await t.accept();
    expect(t.loop.getState()).toBe("thinking");
    expect(t.cues).toEqual(["sent"]);

    const reply = t.sends[0]!.reply;
    reply.onReplyText("You have **two** meet");
    expect(t.loop.getState()).toBe("thinking");
    reply.onReplyText("You have **two** meetings today. The first is at");
    expect(t.spoken).toEqual(["You have two meetings today."]);
    expect(t.loop.getState()).toBe("speaking");

    reply.onReplyText("You have **two** meetings today. The first is at 10:30.");
    reply.onReplyDone();
    expect(t.spoken).toEqual(["You have two meetings today.", "The first is at 10:30."]);
    expect(t.loop.getState()).toBe("speaking");
    expect(t.listens).toHaveLength(1);

    t.mouth.drained!();
    expect(t.loop.getState()).toBe("listening");
    expect(t.listens).toHaveLength(2);
    expect(t.states).toEqual(["listening", "sending", "thinking", "speaking", "listening"]);
    expect(t.mouth.stops).toBe(0);
  });

  it("never sends an empty transcript and listens again", async () => {
    const t = setup();
    t.loop.start();

    await t.hear({ text: "   " });

    expect(t.sends).toEqual([]);
    expect(t.listens).toHaveLength(2);
    expect(t.listens[1]!.signal.aborted).toBe(false);
    expect(t.loop.getState()).toBe("listening");
    expect(t.states).toEqual(["listening"]);
  });

  it("ends when the ears give up", async () => {
    const t = setup();
    t.loop.start();

    await t.hear({ gaveUp: true });

    expect(t.loop.getState()).toBe("ended");
    expect(t.endings).toEqual([{ reason: "gave-up", unsentText: null }]);
    expect(t.mouth.drained).toBeNull();
  });

  it("goes back to thinking when the mouth runs dry before the reply is done", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Check the build.");

    reply.onReplyText("I am checking the build now. ");
    reply.onReplyText("I am checking the build now. Wait");
    expect(t.loop.getState()).toBe("speaking");
    t.mouth.drained!();
    expect(t.loop.getState()).toBe("thinking");
    expect(t.listens).toHaveLength(1);

    reply.onReplyDone();
    expect(t.spoken).toEqual(["I am checking the build now.", "Wait."]);
    expect(t.loop.getState()).toBe("speaking");
    t.mouth.drained!();
    expect(t.loop.getState()).toBe("listening");
  });

  it("listens straight away when the reply has nothing to say", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Do it quietly.");

    reply.onReplyDone();

    expect(t.spoken).toEqual([]);
    expect(t.loop.getState()).toBe("listening");
    expect(t.listens).toHaveLength(2);
  });

  it("pulses only while thinking", async () => {
    const t = setup();
    t.loop.start();
    expect(t.pulse.tick).toBeNull();
    const reply = await t.ask("Think about it.");

    t.pulse.tick!();
    t.pulse.tick!();
    expect(t.cues).toEqual(["sent", "thinking", "thinking"]);

    reply.onReplyText("Here is a first thought. And");
    expect(t.loop.getState()).toBe("speaking");
    expect(t.pulse.tick).toBeNull();
  });

  it("takes a reply that starts before the send is acknowledged", async () => {
    const t = setup();
    t.loop.start();
    await t.hear({ text: "Hello there." });
    const reply = t.sends[0]!.reply;

    reply.onReplyText("Hello to you as well. How");
    expect(t.cues).toEqual(["sent"]);
    expect(t.loop.getState()).toBe("speaking");

    await t.accept();
    expect(t.cues).toEqual(["sent"]);
    expect(t.loop.getState()).toBe("speaking");
    expect(t.loop.end()).toEqual({ reason: "closed", unsentText: null });
  });

  it("stops the mouth and listens when interrupted while speaking", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Tell me a long story.");
    reply.onReplyText("Once upon a time there was a fox. It");

    t.loop.interrupt();

    expect(t.mouth.stops).toBe(1);
    expect(t.loop.getState()).toBe("listening");
    expect(t.listens).toHaveLength(2);

    reply.onReplyText("Once upon a time there was a fox. It ran far away. Then");
    reply.onNeedsUser("approval");
    reply.onReplyDone();
    reply.onConnectionLost();
    t.mouth.drained!();
    expect(t.spoken).toEqual(["Once upon a time there was a fox."]);
    expect(t.cues).toEqual(["sent"]);
    expect(t.loop.getState()).toBe("listening");
    expect(t.listens).toHaveLength(2);
  });

  it("listens when interrupted while thinking, and ignores that turn's late reply", async () => {
    const t = setup();
    t.loop.start();
    const first = await t.ask("First question, please.");

    t.loop.interrupt();
    expect(t.mouth.stops).toBe(1);
    expect(t.loop.getState()).toBe("listening");

    const second = await t.ask("Second question instead.");
    first.onReplyText("An answer to the first question. More");
    first.onReplyDone();
    expect(t.spoken).toEqual([]);
    expect(t.loop.getState()).toBe("thinking");

    second.onReplyText("An answer to the second question. More");
    expect(t.spoken).toEqual(["An answer to the second question."]);
  });

  it("does nothing when interrupted outside a reply", async () => {
    const t = setup();
    t.loop.interrupt();
    expect(t.loop.getState()).toBe("idle");

    t.loop.start();
    t.loop.interrupt();
    expect(t.listens).toHaveLength(1);

    await t.hear({ text: "Send this one." });
    t.loop.interrupt();
    expect(t.loop.getState()).toBe("sending");
    expect(t.mouth.stops).toBe(0);
  });

  it("waits for the user on an approval and does not listen until resumed", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Delete the old notes.");
    reply.onReplyText("I need to delete three files. Is");

    reply.onNeedsUser("approval");
    reply.onNeedsUser("approval");
    expect(t.cues).toEqual(["sent", "needs-you"]);
    expect(t.loop.getState()).toBe("needs-you");

    t.mouth.drained!();
    t.loop.interrupt();
    expect(t.loop.getState()).toBe("needs-you");
    expect(t.listens).toHaveLength(1);

    t.loop.resume();
    expect(t.loop.getState()).toBe("thinking");

    reply.onReplyText("I need to delete three files. Is that fine? They are gone now.");
    reply.onReplyDone();
    expect(t.spoken).toEqual([
      "I need to delete three files.",
      "Is that fine?",
      "They are gone now.",
    ]);
    t.mouth.drained!();
    expect(t.loop.getState()).toBe("listening");
    expect(t.states).toEqual([
      "listening",
      "sending",
      "thinking",
      "speaking",
      "needs-you",
      "thinking",
      "speaking",
      "listening",
    ]);
  });

  it("listens on resume when the reply finished while it waited", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Which one do you want?");

    reply.onNeedsUser("question");
    reply.onReplyText("I picked the first one for you.");
    reply.onReplyDone();
    expect(t.spoken).toEqual(["I picked the first one for you."]);
    expect(t.loop.getState()).toBe("needs-you");

    t.loop.resume();
    expect(t.loop.getState()).toBe("speaking");
    t.mouth.drained!();
    expect(t.loop.getState()).toBe("listening");

    t.loop.resume();
    expect(t.loop.getState()).toBe("listening");
  });

  it("speaks what arrived, says the connection is lost once, and ends", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Summarise my week.");
    reply.onReplyText("You had a busy week. On Monday you");

    reply.onConnectionLost();
    reply.onConnectionLost();
    reply.onReplyText("You had a busy week. On Monday you rested. And then");
    expect(t.spoken).toEqual(["You had a busy week.", "On Monday you."]);
    expect(t.loop.getState()).toBe("speaking");
    expect(t.cues).toEqual(["sent"]);

    t.mouth.drained!();
    expect(t.cues).toEqual(["sent", "connection-lost"]);
    expect(t.loop.getState()).toBe("ended");
    expect(t.endings).toEqual([{ reason: "connection-lost", unsentText: null }]);
    expect(t.mouth.stops).toBe(0);
    expect(t.listens).toHaveLength(1);
  });

  it("ends at once when the connection is lost with nothing left to say", async () => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Are you there?");
    reply.onNeedsUser("approval");

    reply.onConnectionLost();

    expect(t.cues).toEqual(["sent", "needs-you", "connection-lost"]);
    expect(t.loop.getState()).toBe("ended");
  });

  it("keeps the words when the connection is lost before the send went through", async () => {
    const t = setup();
    t.loop.start();
    await t.hear({ text: "Remember the milk." });

    t.sends[0]!.reply.onConnectionLost();

    expect(t.endings).toEqual([{ reason: "connection-lost", unsentText: "Remember the milk." }]);
    expect(t.cues).toEqual(["connection-lost"]);
  });

  it("ends with the words when sending fails", async () => {
    const t = setup();
    t.loop.start();
    await t.hear({ text: "Remember the milk." });
    const error = new Error("offline");

    t.sends[0]!.sent.reject(error);
    await t.sends[0]!.sent.promise.catch(() => undefined);

    expect(t.loop.getState()).toBe("ended");
    expect(t.endings).toEqual([{ reason: "failed", unsentText: "Remember the milk.", error }]);
  });

  it("ends when the ears fail", async () => {
    const t = setup();
    t.loop.start();
    const error = new Error("no microphone");

    t.listens[0]!.heard.reject(error);
    await t.listens[0]!.heard.promise.catch(() => undefined);

    expect(t.endings).toEqual([{ reason: "failed", unsentText: null, error }]);
  });

  it("reports the unsent words when ended while sending", async () => {
    const t = setup();
    t.loop.start();
    await t.hear({ text: "Buy bread tomorrow." });

    expect(t.loop.end()).toEqual({ reason: "closed", unsentText: "Buy bread tomorrow." });
    expect(t.loop.getState()).toBe("ended");

    await t.accept();
    t.sends[0]!.reply.onReplyText("A whole sentence arrives late. And");
    expect(t.loop.getState()).toBe("ended");
    expect(t.spoken).toEqual([]);
    expect(t.cues).toEqual([]);
    expect(t.loop.end()).toEqual({ reason: "closed", unsentText: "Buy bread tomorrow." });
    expect(t.endings).toHaveLength(1);
  });

  it("stops the ears when ended while listening", async () => {
    const t = setup();
    t.loop.start();

    expect(t.loop.end()).toEqual({ reason: "closed", unsentText: null });
    expect(t.listens[0]!.signal.aborted).toBe(true);
    expect(t.mouth.stops).toBe(1);

    await t.hear({ text: "Too late to count." });
    expect(t.sends).toEqual([]);
    expect(t.loop.getState()).toBe("ended");

    t.loop.start();
    expect(t.listens).toHaveLength(1);
  });

  it.each(["thinking", "speaking", "needs-you"] as const)("ends from %s", async (from) => {
    const t = setup();
    t.loop.start();
    const reply = await t.ask("Go on, please.");
    if (from === "speaking") reply.onReplyText("A sentence to say aloud. And");
    if (from === "needs-you") reply.onNeedsUser("question");
    expect(t.loop.getState()).toBe(from);

    expect(t.loop.end()).toEqual({ reason: "closed", unsentText: null });

    expect(t.mouth.stops).toBe(1);
    expect(t.pulse.tick).toBeNull();
    expect(t.mouth.drained).toBeNull();
    reply.onReplyDone();
    t.loop.resume();
    t.loop.interrupt();
    expect(t.loop.getState()).toBe("ended");
    expect(t.listens).toHaveLength(1);
  });

  it("stops telling a listener that unsubscribed", async () => {
    const t = setup();
    const seen: ConversationState[] = [];
    const unsubscribe = t.loop.subscribe((state) => void seen.push(state));

    t.loop.start();
    unsubscribe();
    await t.hear({ text: "Anything at all." });

    expect(seen).toEqual(["listening"]);
  });
});
