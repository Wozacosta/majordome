/// <reference lib="dom" />
import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

interface Recorded {
  said: Array<{ text: string; lang: string }>;
  calls: string[];
}

const VOICE_HOST = "https://voices.scenario.test";
// One megabyte, so the dialog has a size to state.
const VOICE_FILE = "v".repeat(1_000_000);
const VOICE_FILE_SHA256 = "45e6b24e2d8d2515d6690f45f7cbc81c0fdb6a9248621d6ef87fe5cec3d87bf6";

test(
  "A reply is read aloud without its code, the button becomes Stop, and leaving the chat stops it",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    const thread = await t3.thread({
      project: notes,
      title: "Backup",
      messages: ["How did the backup go?"],
      model: "read-aloud",
    });

    // The voice is replaced by one that records what it is asked to say, and its files by one
    // small file, so neither a graphics card nor the real download is needed.
    await browser.addInitScript(
      ({ host, size, sha256, id }) => {
        const recorded: Recorded = { said: [], calls: [] };
        const sounding = new Set<(value: boolean) => void>();
        const listen =
          <A>(listeners: Set<A>) =>
          (listener: A) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          };
        Object.assign(window, {
          readAloudRecorded: recorded,
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
                recorded.said.push({ text, lang: options.lang });
                for (const listener of sounding) listener(true);
              },
              stop: () => {
                recorded.calls.push("stop");
                for (const listener of sounding) listener(false);
              },
              end: () => void recorded.calls.push("end"),
              onDrained: listen(new Set()),
              onError: listen(new Set()),
              onSounding: listen(sounding),
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
      },
    );
    let damaged = true;
    await browser.route(`${VOICE_HOST}/voice.bin`, (route) =>
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
        body: damaged ? `x${VOICE_FILE.slice(1)}` : VOICE_FILE,
      }),
    );
    const decodeRecorded = (json: string): Recorded => JSON.parse(json);
    const recorded = async () =>
      decodeRecorded(
        await browser.evaluate(() =>
          JSON.stringify((window as unknown as { readAloudRecorded: Recorded }).readAloudRecorded),
        ),
      );

    await t3.open(thread);
    const readAloud = screen.getByRole("button", "Read aloud", { exact: true });
    await expect(readAloud).toBeVisible({ timeout: 120_000 });
    await app.screenshot("reply-with-read-aloud");

    // First use offers the download; a file that fails its checksum leaves the offer standing.
    await readAloud.tap();
    const download = screen.getByRole("button", "Download", { exact: true });
    await expect(screen.getByText("Download the voice (1 MB)", { exact: true })).toBeVisible();
    await app.screenshot("download-offered");
    await download.tap();
    await expect(
      screen.getByText("The download was damaged. Try again.", { exact: true }),
    ).toBeVisible();
    await expect(download).toBeVisible();
    await app.screenshot("download-damaged");
    expect((await recorded()).said).toEqual([]);

    // The second try arrives whole: the dialog closes and the reply that asked is read.
    damaged = false;
    await download.tap();
    const stop = screen.getByRole("button", "Stop", { exact: true });
    await expect(stop).toBeVisible();
    await app.screenshot("reading-shows-stop");
    const { said } = await recorded();
    expect(said.map((sentence) => sentence.text)).toEqual([
      "The backup ran last night and every note was copied.",
      "It took four minutes, which is about what it takes each week.",
      "There is code on screen.",
      "Nothing needs your attention today.",
      "I will check again on Friday and tell you if anything changes.",
    ]);
    expect(said.every((sentence) => sentence.lang === "en")).toBe(true);
    expect(said.some((sentence) => sentence.text.includes("rsync"))).toBe(false);

    // Leaving the chat stops the reading.
    await screen.getByRole("link", "Today", { exact: true }).tap();
    await expect.poll(async () => (await recorded()).calls).toEqual(["prepare", "stop"]);

    // The voice is now on this computer, so Settings offers the voices and the removal.
    await t3.open("/settings/voice");
    const remove = screen.getByRole("button", "Remove the download", { exact: true });
    await expect(remove).toBeVisible({ timeout: 30_000 });
    await remove.scrollIntoView();
    await app.screenshot("speaking-settings");
  },
);
