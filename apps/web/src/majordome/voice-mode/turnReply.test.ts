import type { ConversationReply } from "@t3tools/client-runtime/speaking";
import { describe, expect, it } from "vite-plus/test";

import { createTurnReplyRouter, type TurnSnapshot } from "./turnReply";

function recorder() {
  const calls: Array<string> = [];
  const reply: ConversationReply = {
    onReplyText: (text) => void calls.push(`text ${text}`),
    onReplyDone: () => void calls.push("done"),
    onNeedsUser: (kind) => void calls.push(`needs ${kind}`),
    onConnectionLost: () => void calls.push("lost"),
  };
  return { calls, reply };
}

const chat = (overrides: Partial<TurnSnapshot> = {}): TurnSnapshot => ({
  runs: [],
  messages: [],
  needs: null,
  connected: true,
  ...overrides,
});
const run = (id: string, userMessageId: string, status = "running") => ({
  id,
  userMessageId,
  status,
});
const said = (runId: string, text: string, streaming = false, role = "assistant") => ({
  runId,
  role,
  text,
  streaming,
});

describe("turn reply router", () => {
  it("routes one turn's streamed text and its end, and nothing after", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m2", reply, () => {});
    router.update(chat({ runs: [run("r2", "m2", "starting")] }));
    router.update(chat({ runs: [run("r2", "m2")], messages: [said("r2", "It is", true)] }));
    router.update(chat({ runs: [run("r2", "m2")], messages: [said("r2", "It is sunny.", true)] }));
    // The run settles before its last message stops streaming: not done yet.
    router.update(
      chat({ runs: [run("r2", "m2", "completed")], messages: [said("r2", "It is sunny.", true)] }),
    );
    router.update(
      chat({ runs: [run("r2", "m2", "completed")], messages: [said("r2", "It is sunny.")] }),
    );
    router.update(
      chat({ runs: [run("r2", "m2", "completed")], messages: [said("r2", "It is sunny. More")] }),
    );
    expect(calls).toEqual([
      "text It is",
      "text It is sunny.",
      "text It is sunny.",
      "text It is sunny.\n\n",
      "done",
    ]);
  });

  it("speaks only its own turn: not earlier answers, the user's words or another run", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m2", reply, () => {});
    router.update(
      chat({
        runs: [run("r1", "m1", "completed"), run("r2", "m2"), run("r3", "m3")],
        messages: [
          said("r1", "Yesterday's answer."),
          said("r2", "What is on today?", false, "user"),
          said("r2", "First part."),
          said("r2", "Second part.", true),
          said("r3", "A wake from a background task."),
          { ...said("r2", "const script = 1;"), workflowScript: true },
        ],
      }),
    );
    expect(calls).toEqual(["text First part.\n\nSecond part."]);
  });

  it("drops a turn it no longer follows", () => {
    const router = createTurnReplyRouter();
    const first = recorder();
    const second = recorder();
    router.watch("m1", first.reply, () => {});
    router.update(chat({ runs: [run("r1", "m1")], messages: [said("r1", "Old", true)] }));
    router.watch("m2", second.reply, () => {});
    router.update(
      chat({
        runs: [run("r1", "m1", "completed"), run("r2", "m2")],
        messages: [said("r1", "Old answer, finished."), said("r2", "New", true)],
      }),
    );
    expect(first.calls).toEqual(["text Old"]);
    expect(second.calls).toEqual(["text New"]);
  });

  it("keeps the reply growing when a finished message is written to again", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m1", reply, () => {});
    router.update(chat({ runs: [run("r1", "m1")], messages: [said("r1", "One.")] }));
    router.update(chat({ runs: [run("r1", "m1")], messages: [said("r1", "One. Two.", true)] }));
    router.update(
      chat({ runs: [run("r1", "m1")], messages: [said("r1", "One. Two."), said("r1", "Three.")] }),
    );
    expect(calls).toEqual([
      "text One.\n\n",
      "text One.\n\n Two.",
      "text One.\n\n Two.\n\nThree.\n\n",
    ]);
  });

  it("stops routing once unwatched", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    const unwatch = router.watch("m1", reply, () => {});
    unwatch();
    router.update(chat({ runs: [run("r1", "m1", "completed")], messages: [said("r1", "Late")] }));
    expect(calls).toEqual([]);
  });

  it("says once that the user is needed, and tells when they have answered", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m1", reply, () => void calls.push("answered"));
    const waiting = chat({
      runs: [run("r1", "m1", "waiting")],
      messages: [said("r1", "I will delete the file.")],
      needs: { kind: "approval", id: "request-1" },
    });
    router.update(waiting);
    router.update(waiting);
    router.update(
      chat({ runs: [run("r1", "m1")], messages: [said("r1", "I will delete the file.")] }),
    );
    router.update(
      chat({
        runs: [run("r1", "m1")],
        messages: [said("r1", "I will delete the file.")],
        needs: { kind: "question", id: "request-2" },
      }),
    );
    expect(calls).toEqual([
      "text I will delete the file.\n\n",
      "needs approval",
      "text I will delete the file.\n\n",
      "text I will delete the file.\n\n",
      "answered",
      "text I will delete the file.\n\n",
      "needs question",
    ]);
  });

  it("does not ask for the user over a request left from a turn that already ended", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m1", reply, () => {});
    router.update(
      chat({
        runs: [run("r1", "m1", "completed")],
        messages: [said("r1", "Done.")],
        needs: { kind: "approval", id: "stale" },
      }),
    );
    expect(calls).toEqual(["text Done.\n\n", "done"]);
  });

  it("reports a lost connection once, after what had arrived", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m1", reply, () => {});
    router.update(chat({ runs: [run("r1", "m1")], messages: [said("r1", "Half an", true)] }));
    const offline = chat({
      runs: [run("r1", "m1")],
      messages: [said("r1", "Half an", true)],
      connected: false,
    });
    router.update(offline);
    router.update(offline);
    expect(calls).toEqual(["text Half an", "text Half an", "lost"]);
  });

  it("reports a lost connection for a message that never reached the computer", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.watch("m1", reply, () => {});
    router.update(chat({ connected: false }));
    expect(calls).toEqual(["lost"]);
  });

  it("routes a turn that finished before it was watched", () => {
    const router = createTurnReplyRouter();
    const { calls, reply } = recorder();
    router.update(chat({ runs: [run("r1", "m1", "completed")], messages: [said("r1", "Quick.")] }));
    router.watch("m1", reply, () => {});
    expect(calls).toEqual(["text Quick.\n\n", "done"]);
  });
});
