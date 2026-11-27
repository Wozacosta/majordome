/// <reference lib="dom" />
// @effect-diagnostics nodeBuiltinImport:off - reads the app's database behind its back, outside
// the app's own services.
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

interface Recorded {
  /** Each sentence the voice was asked to say, and how many finished replies were on screen then. */
  said: Array<{ text: string; lang: string; repliesOnScreen: number }>;
  calls: string[];
}

const VOICE_HOST = "https://voices.scenario.test";
// One megabyte, so the dialog has a size to state.
const VOICE_FILE = "v".repeat(1_000_000);
const VOICE_FILE_SHA256 = "45e6b24e2d8d2515d6690f45f7cbc81c0fdb6a9248621d6ef87fe5cec3d87bf6";
const REPLY = [
  "The backup ran last night and every note was copied.",
  "It took four minutes, which is about what it takes each week.",
  "There is code on screen.",
  "Nothing needs your attention today.",
  "I will check again on Friday and tell you if anything changes.",
];

/** The server's own record of a chat's turns: whether each was asked to answer in spoken sentences. */
function turns(threadId?: string) {
  const database = new NodeSqlite.DatabaseSync(
    NodePath.join(T3_HOME, "userdata", "statev2.sqlite"),
    { readOnly: true },
  );
  try {
    return database
      .prepare(
        `SELECT thread_id AS threadId, ordinal,
                json_extract(payload_json, '$.replyStyle') AS replyStyle
           FROM orchestration_v2_projection_runs
          ORDER BY requested_at`,
      )
      .all()
      .filter((row) =>
        threadId === undefined ? !known.includes(String(row.threadId)) : row.threadId === threadId,
      )
      .map((row) => ({ ordinal: Number(row.ordinal), replyStyle: row.replyStyle ?? null }));
  } finally {
    database.close();
  }
}
/** Chats this scenario seeded; any other chat is the new one it started by voice. */
const known: string[] = [];

test(
  "A voice chat in the window: a spoken turn is sent and answered aloud, then it listens again",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    const thread = await t3.thread({
      project: notes,
      title: "Backup",
      messages: ["How did the backup go?"],
      model: "read-aloud",
    });
    known.push(thread.threadId);

    // The voice is replaced by one that records what it is asked to say and stays "speaking"
    // until the scenario lets it finish; the ears by a seam the scenario speaks through.
    await browser.addInitScript(
      ({ host, size, sha256, id, lastSentence }) => {
        const recorded: Recorded = { said: [], calls: [] };
        const drained = new Set<() => void>();
        const started = new Set<(id: number) => void>();
        const listen =
          <A>(listeners: Set<A>) =>
          (listener: A) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          };
        let queued: number[] = [];
        Object.assign(window, {
          voiceChatRecorded: recorded,
          /** The voice finishes everything it was asked to say. */
          voiceChatFinishSpeaking: () => {
            for (const sentence of queued.splice(0)) for (const tell of started) tell(sentence);
            for (const tell of Array.from(drained)) tell();
          },
          __majordomeVoiceMode: { fakeEars: true },
          __majordomeSpeaking: {
            support: { halfFloats: true },
            catalog: {
              id,
              name: "Scenario voice",
              baseUrl: host,
              license: "openrail-m",
              copyright: "",
              languages: ["en", "fr"],
              files: [{ name: "voice.bin", size, sha256 }],
            },
            engine: {
              prepare: async () => void recorded.calls.push("prepare"),
              speak: (text: string, options: { lang: string }) => {
                recorded.said.push({
                  text,
                  lang: options.lang,
                  repliesOnScreen: document.body.innerText.split(lastSentence).length - 1,
                });
                queued.push(recorded.said.length);
                return recorded.said.length;
              },
              stop: () => {
                queued = [];
                recorded.calls.push("stop");
              },
              end: () => void recorded.calls.push("end"),
              hold: () => {
                recorded.calls.push("hold");
                return () => void recorded.calls.push("release");
              },
              onDrained: listen(drained),
              onSentence: listen(started),
              onError: listen(new Set()),
              onSounding: listen(new Set()),
            },
          },
        });
      },
      {
        host: VOICE_HOST,
        size: VOICE_FILE.length,
        sha256: VOICE_FILE_SHA256,
        // A folder of its own in the browser's storage, whatever an earlier run left.
        id: `scenario-${thread.threadId}`,
        lastSentence: "tell you if anything changes",
      },
    );
    await browser.route(`${VOICE_HOST}/voice.bin`, (route) =>
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
        body: VOICE_FILE,
      }),
    );
    const decodeRecorded = (json: string): Recorded => JSON.parse(json);
    const recorded = async () =>
      decodeRecorded(
        await browser.evaluate(() =>
          JSON.stringify((window as unknown as { voiceChatRecorded: Recorded }).voiceChatRecorded),
        ),
      );
    const say = (text: string) =>
      browser.evaluate((words) => {
        (
          window as unknown as { __majordomeVoiceMode: { say: (text: string) => void } }
        ).__majordomeVoiceMode.say(words);
        return null;
      }, text);
    const finishSpeaking = () =>
      browser.evaluate(() => {
        (window as unknown as { voiceChatFinishSpeaking: () => void }).voiceChatFinishSpeaking();
        return null;
      });
    const panel = screen.getByRole("group", "Voice mode", { exact: true });

    await t3.open(thread);
    // The button stands where Send does while the composer is empty.
    const talk = screen.getByRole("button", "Talk", { exact: true });
    await expect(talk).toBeVisible({ timeout: 120_000 });
    await app.screenshot("talk-button-in-the-composer");

    // First use offers the voice's download; the conversation starts once it has arrived.
    await talk.tap();
    await expect(screen.getByText("Download the voice (1 MB)", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Download", { exact: true }).tap();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Listening", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", "Send", { exact: true })).toBeVisible();
    await app.screenshot("listening");

    // What was said lands as a normal message, and the server is told the answer is spoken.
    await say("How did the backup go this week?");
    await expect(screen.getByText("How did the backup go this week?").first()).toBeVisible();
    await expect.poll(async () => (await recorded()).said.length).toBe(REPLY.length);
    expect(turns(thread.threadId)).toEqual([
      { ordinal: 1, replyStyle: null },
      { ordinal: 2, replyStyle: "spoken" },
    ]);
    const { said } = await recorded();
    expect(said.map((sentence) => sentence.text)).toEqual(REPLY);
    expect(said.some((sentence) => sentence.text.includes("rsync"))).toBe(false);
    // The first sentence reached the voice while the answer was still being written: only the
    // earlier answer's last sentence was on screen then.
    expect(said[0]?.repliesOnScreen).toBe(1);
    await expect(panel.getByText("Speaking", { exact: true })).toBeVisible();
    await app.screenshot("speaking");

    // Once everything has been said it listens again.
    await finishSpeaking();
    await expect(panel.getByText("Listening", { exact: true })).toBeVisible();
    await expect(panel.getByText(REPLY.at(-1)!, { exact: true })).toBeVisible();
    await app.screenshot("listening-again");

    // Interrupting silences the voice and goes straight back to listening.
    await say("Tell me again.");
    const interrupt = panel.getByRole("button", "Interrupt", { exact: true });
    await expect(interrupt).toBeVisible();
    await interrupt.tap();
    await expect(panel.getByText("Listening", { exact: true })).toBeVisible();
    expect((await recorded()).calls).toContain("stop");

    // Closing before the words have left keeps them in the composer, unsent.
    await browser.evaluate(async (words) => {
      (
        window as unknown as { __majordomeVoiceMode: { say: (text: string) => void } }
      ).__majordomeVoiceMode.say(words);
      // The conversation takes the words in; the message has not left yet.
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
      document.querySelector<HTMLElement>('[aria-label="End voice mode"]')?.click();
      return null;
    }, "Remind me to call Ana");
    await expect(panel).toBeHidden();
    await expect(screen.getByText("Remind me to call Ana", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Submit message", { exact: true })).toBeVisible();
    await app.screenshot("unsent-words-in-the-composer");
    expect(turns(thread.threadId)).toHaveLength(3);
    expect((await recorded()).calls.at(-1)).toBe("release");

    // A new chat's first message can be spoken too, and is marked spoken like any other.
    await screen.getByRole("button", "New chat", { exact: true }).first().tap();
    await expect(talk).toBeVisible();
    await talk.tap();
    await expect(panel.getByText("Listening", { exact: true })).toBeVisible();
    await say("What is on today?");
    await expect.poll(() => turns()).toEqual([{ ordinal: 1, replyStyle: "spoken" }]);
    await expect(panel).toBeVisible();
  },
);
