import type { ConversationHeard } from "@t3tools/client-runtime/speaking";
import { describe, expect, it } from "vite-plus/test";

import { armSpokenReply, withSpokenReply } from "./spokenSend";
import { createTurnReplyRouter, type TurnSnapshot } from "./turnReply";
import { createVoiceModeRuntime } from "./voiceModeRuntime";

const CHAT = "env-1:thread-1";

/** A whole conversation over fakes: ears the test speaks into, an engine that records what it
 * was asked to say, and a chat whose outbox and projection the test plays the server for. */
function world() {
  const said: Array<string> = [];
  const events: Array<string> = [];
  const outbox: Array<{ text: string; messageId: string; replyStyle?: "spoken" }> = [];
  let draft = "";
  let queued: Array<number> = [];
  let nextSentence = 0;
  const drained = new Set<() => void>();
  const started = new Set<(id: number) => void>();
  const routers = new Set<{ update(snapshot: TurnSnapshot): void }>();
  const timers = new Set<() => void>();
  let chat: TurnSnapshot = { runs: [], messages: [], needs: null, connected: true };
  let listening: {
    readonly resolve: (heard: ConversationHeard) => void;
    readonly signal: AbortSignal;
  } | null = null;
  let listens = 0;
  let sendBlocked: Promise<void> | null = null;
  let takenAway: (() => void) | null = null;
  let headset: (() => void) | null = null;

  const host = {
    setDraft: (text: string) => {
      draft = text;
    },
    send: async () => {
      await sendBlocked;
      if (draft.trim() === "") return null;
      const messageId = `m${outbox.length + 1}`;
      // The composer's send path ends in the outbox, where the spoken mark is picked up.
      outbox.push(
        withSpokenReply({ environmentId: "env-1", threadId: "thread-1", text: draft, messageId }),
      );
      draft = "";
      return messageId;
    },
    stopTurn: () => void events.push("stop turn"),
  };

  const runtime = createVoiceModeRuntime({
    ears: {
      permit: async () => true,
      listen: (signal) =>
        new Promise((resolve, reject) => {
          listens += 1;
          listening = { resolve, signal };
          signal.addEventListener("abort", () => {
            listening = null;
            reject(new Error("aborted"));
          });
        }),
      sendNow: () => void events.push("send now"),
    },
    mouth: {
      hold: async () => {
        events.push("voice loaded");
        return () => void events.push("voice let go");
      },
      speak: (sentence) => {
        said.push(sentence);
        queued.push(++nextSentence);
        return nextSentence;
      },
      stop: () => {
        queued = [];
        events.push("mouth stopped");
      },
      onDrained: (callback) => {
        drained.add(callback);
        return () => void drained.delete(callback);
      },
      onSentence: (callback) => {
        started.add(callback);
        return () => void started.delete(callback);
      },
    },
    takeAudio: async () => {
      events.push("audio taken");
      return () => void events.push("audio released");
    },
    watchTurn: (_chatKey, messageId, reply, onAnswered) => {
      const router = createTurnReplyRouter();
      routers.add(router);
      const unwatch = router.watch(messageId, reply, onAnswered);
      router.update(chat);
      return () => {
        unwatch();
        routers.delete(router);
      };
    },
    armSpokenReply,
    cue: (kind) => void events.push(`cue ${kind}`),
    pulse: () => () => {},
    language: () => "en",
    phrase: (kind) => ({
      text:
        kind === "connection-lost" ? "The connection was lost." : "I need your answer on screen.",
      lang: "en",
    }),
    speakable: () => ({ codeLine: "", tableLine: "" }),
    settle: async () => {},
    keepAwake: () => {
      events.push("awake");
      return () => void events.push("may sleep");
    },
    onTakenAway: (callback) => {
      takenAway = callback;
      return () => {
        takenAway = null;
      };
    },
    onHeadsetButton: (callback) => {
      headset = callback;
      return () => {
        headset = null;
      };
    },
    reportError: (reason) => void events.push(`error ${reason}`),
    setTimer: (callback) => {
      timers.add(callback);
      return () => void timers.delete(callback);
    },
  });

  const flush = async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  };
  return {
    runtime,
    host,
    said,
    events,
    outbox,
    draft: () => draft,
    state: () => runtime.getSnapshot().state,
    line: () => runtime.getSnapshot().line,
    listens: () => listens,
    isListening: () => listening !== null,
    open: async () => {
      const detach = runtime.attach(CHAT, host);
      await runtime.open(CHAT);
      await flush();
      return detach;
    },
    /** The user says something and stops talking. */
    hear: async (text: string) => {
      listening?.resolve({ text });
      listening = null;
      await flush();
    },
    giveUp: async () => {
      listening?.resolve({ gaveUp: true });
      listening = null;
      await flush();
    },
    /** The server's view of the chat changed. */
    server: async (next: Partial<TurnSnapshot>) => {
      chat = { ...chat, ...next };
      for (const router of routers) router.update(chat);
      await flush();
    },
    /** The engine finishes everything it was asked to say. */
    finishSpeaking: async () => {
      for (const id of queued.splice(0)) for (const callback of started) callback(id);
      for (const callback of Array.from(drained)) callback();
      await flush();
    },
    blockSend: () => {
      let release = () => {};
      sendBlocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    takeAway: () => takenAway?.(),
    pressHeadsetButton: () => headset?.(),
    runTimers: () => {
      for (const callback of Array.from(timers)) {
        timers.delete(callback);
        callback();
      }
    },
    flush,
  };
}

const running = (text: string, streaming = true) => ({
  runs: [{ id: "r1", userMessageId: "m1", status: "running" }],
  messages: [{ runId: "r1", role: "assistant", text, streaming }],
});
const finished = (text: string) => ({
  runs: [{ id: "r1", userMessageId: "m1", status: "completed" }],
  messages: [{ runId: "r1", role: "assistant", text, streaming: false }],
});

describe("a spoken conversation", () => {
  it("sends what was heard as a normal message, marked spoken", async () => {
    const w = world();
    await w.open();
    expect(w.state()).toBe("listening");
    expect(w.events).toEqual(["audio taken", "voice loaded", "awake"]);

    await w.hear("What is on today?");
    expect(w.outbox).toEqual([
      {
        environmentId: "env-1",
        threadId: "thread-1",
        text: "What is on today?",
        messageId: "m1",
        replyStyle: "spoken",
      },
    ]);
    expect(w.draft()).toBe("");
    expect(w.line()).toEqual({ who: "you", text: "What is on today?" });
    expect(w.state()).toBe("thinking");
    expect(w.events).toContain("cue sent");

    // A message typed afterwards in the same chat is not spoken.
    w.host.setDraft("typed later");
    await w.host.send();
    expect(w.outbox[1]).not.toHaveProperty("replyStyle");
  });

  it("speaks each sentence as it arrives, before the turn ends, then listens again", async () => {
    const w = world();
    await w.open();
    await w.hear("What is on today?");

    await w.server(running("You have three meetings. The first"));
    expect(w.said).toEqual(["You have three meetings."]);
    expect(w.state()).toBe("speaking");
    expect(w.isListening()).toBe(false);

    await w.server(running("You have three meetings. The first is at nine. Then"));
    expect(w.said).toEqual(["You have three meetings.", "The first is at nine."]);

    // The engine catches up while the answer is still coming: no listening yet.
    await w.finishSpeaking();
    expect(w.line()).toEqual({ who: "assistant", text: "The first is at nine." });
    expect(w.state()).toBe("thinking");
    expect(w.isListening()).toBe(false);

    await w.server(finished("You have three meetings. The first is at nine. Then lunch."));
    expect(w.said.at(-1)).toBe("Then lunch.");
    expect(w.state()).toBe("speaking");
    expect(w.isListening()).toBe(false);

    await w.finishSpeaking();
    expect(w.state()).toBe("listening");
    expect(w.listens()).toBe(2);
  });

  it("never speaks tool activity or code, only the reply's prose", async () => {
    const w = world();
    await w.open();
    await w.hear("Fix it");
    await w.server({
      runs: [{ id: "r1", userMessageId: "m1", status: "completed" }],
      messages: [
        { runId: "r1", role: "system", text: "Ran 3 commands", streaming: false },
        {
          runId: "r1",
          role: "assistant",
          text: "Done.\n\n```ts\nconst a = 1;\n```",
          streaming: false,
        },
      ],
    });
    expect(w.said.join(" ")).not.toContain("Ran 3 commands");
    expect(w.said.join(" ")).not.toContain("const a");
    // The fakes carry no placeholder text, so the code block is simply left out.
    expect(w.said).toEqual(["Done."]);
  });

  it("says once that an answer is needed, and listens only after it is given", async () => {
    const w = world();
    await w.open();
    await w.hear("Delete the old notes");
    await w.server({
      runs: [{ id: "r1", userMessageId: "m1", status: "waiting" }],
      messages: [
        { runId: "r1", role: "assistant", text: "I will delete three notes.", streaming: false },
      ],
      needs: { kind: "approval", id: "request-1" },
    });
    expect(w.state()).toBe("needs-you");
    expect(w.said).toEqual(["I will delete three notes.", "I need your answer on screen."]);

    await w.finishSpeaking();
    await w.server({ needs: { kind: "approval", id: "request-1" } });
    expect(w.state()).toBe("needs-you");
    expect(w.isListening()).toBe(false);
    expect(w.said).toHaveLength(2);
    // Nothing said aloud approves: the conversation has no way to answer the card.
    expect(w.outbox).toHaveLength(1);

    // The user taps Approve on the card.
    await w.server({ needs: null, ...running("I will delete three notes.", false) });
    expect(w.state()).toBe("thinking");
    await w.server(finished("I will delete three notes. They are gone."));
    await w.finishSpeaking();
    expect(w.said.at(-1)).toBe("They are gone.");
    expect(w.state()).toBe("listening");
  });

  it("stops talking, stops the turn and listens when interrupted", async () => {
    const w = world();
    await w.open();
    await w.hear("Tell me everything");
    await w.server(running("This is a long story. It starts"));
    expect(w.state()).toBe("speaking");

    w.runtime.interrupt();
    await w.flush();
    expect(w.events.slice(-2)).toEqual(["mouth stopped", "stop turn"]);
    expect(w.state()).toBe("listening");
    expect(w.isListening()).toBe(true);

    // The interrupted answer keeps arriving; none of it is spoken.
    await w.server(finished("This is a long story. It starts here. And goes on."));
    expect(w.said).toEqual(["This is a long story."]);
    expect(w.state()).toBe("listening");
  });

  it("is interrupted by the headset button too, and only while there is something to stop", async () => {
    const w = world();
    await w.open();
    w.pressHeadsetButton();
    expect(w.events).not.toContain("stop turn");
    await w.hear("Go on");
    w.pressHeadsetButton();
    await w.flush();
    expect(w.events).toContain("stop turn");
    expect(w.state()).toBe("listening");
  });

  it("leaves words that were not sent in the draft when closed", async () => {
    const w = world();
    await w.open();
    const release = w.blockSend();
    await w.hear("Remind me to call Ana");
    expect(w.state()).toBe("sending");

    w.runtime.close();
    expect(w.runtime.getSnapshot()).toEqual({ chatKey: null, state: "idle", line: null });
    expect(w.draft()).toBe("Remind me to call Ana");
    expect(w.events.slice(-4)).toEqual([
      "mouth stopped",
      "may sleep",
      "voice let go",
      "audio released",
    ]);
    release();
  });

  it("closes while it speaks: silent at once, nothing left to send", async () => {
    const w = world();
    await w.open();
    await w.hear("Hello");
    await w.server(running("Hello to you. How"));
    w.runtime.close();
    expect(w.events).toContain("mouth stopped");
    expect(w.draft()).toBe("");
    await w.server(finished("Hello to you. How are you?"));
    expect(w.said).toEqual(["Hello to you."]);
  });

  it("speaks what arrived, says the connection was lost once, and ends", async () => {
    const w = world();
    await w.open();
    await w.hear("What is on today?");
    await w.server(running("You have three meetings. The first"));
    await w.server({ connected: false });
    expect(w.said).toEqual(["You have three meetings.", "The first."]);
    expect(w.state()).toBe("speaking");

    await w.finishSpeaking();
    expect(w.said.at(-1)).toBe("The connection was lost.");
    expect(w.runtime.getSnapshot().chatKey).toBeNull();
    // The audio is kept until the last words are out.
    expect(w.events).not.toContain("audio released");
    expect(w.events).not.toContain("mouth stopped");
    await w.finishSpeaking();
    expect(w.events.at(-1)).toBe("audio released");
    expect(w.said.filter((sentence) => sentence === "The connection was lost.")).toHaveLength(1);
  });

  it("ends after thirty seconds of nothing heard, without a word", async () => {
    const w = world();
    await w.open();
    await w.giveUp();
    expect(w.runtime.getSnapshot().chatKey).toBeNull();
    expect(w.said).toEqual([]);
    expect(w.events).not.toContain("error failed");
    expect(w.events.at(-1)).toBe("audio released");
  });

  it("ends when a call or another app takes the audio", async () => {
    const w = world();
    await w.open();
    w.takeAway();
    expect(w.runtime.getSnapshot().chatKey).toBeNull();
    expect(w.events.at(-1)).toBe("audio released");
  });

  it("ends when the chat is left, but not when a new chat becomes a thread", async () => {
    const w = world();
    const detach = await w.open();
    // The new chat's screen is replaced by the thread's: same chat, new composer.
    detach();
    const detachThread = w.runtime.attach(CHAT, w.host);
    w.runTimers();
    expect(w.state()).toBe("listening");

    detachThread();
    w.runTimers();
    expect(w.runtime.getSnapshot().chatKey).toBeNull();
  });

  it("tells the user when a message could not be sent, and keeps its words", async () => {
    const w = world();
    await w.open();
    w.host.send = async () => null;
    await w.hear("This will not go");
    expect(w.events).toContain("error failed");
    expect(w.draft()).toBe("This will not go");
    expect(w.runtime.getSnapshot().chatKey).toBeNull();
  });
});
