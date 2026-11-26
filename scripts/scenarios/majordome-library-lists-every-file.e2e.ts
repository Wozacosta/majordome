import { expect } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

// A 1x1 red PNG.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAD0lEQVR4AQEEAPv/AP8AAAMBAQCNHeWCAAAAAElFTkSuQmCC";

/** Pastes a PNG the way a clipboard image arrives: a new File named image.png. */
const pastePng = (browser: Browser, base64: string) =>
  browser.evaluate((payload: string) => {
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) throw new Error("No composer editor to paste into");
    return editor.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }, base64);

test(
  "The Library lists the files of every topic and chat, by kind and by topic, and opens one in Notes",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/topics.json": JSON.stringify({
        topics: [
          { id: "money", title: "Money", folder: "money" },
          { id: "trips", title: "Trips", folder: "trips" },
        ],
      }),
      "money/log.md": "# Money\n",
      "money/electricity-bill.pdf": "%PDF-1.4\n",
      "money/prices.csv": "item,price\nbread,2\n",
      "trips/tram.png": Uint8Array.from(atob(PIXEL), (char) => char.charCodeAt(0)),
      "drop/archive.zip": "zip",
    });
    const thread = await t3.thread({ project: notes, title: "Lease", messages: ["first"] });
    await t3.open(thread);
    await expect(screen.getByText("first fixture turn complete", { exact: false })).toBeVisible();
    const composer = screen.getByRole("textbox");
    await composer.fill("Keep this ");
    await pastePng(browser, PIXEL);
    await expect(composer.getByRole("button", "Image attachment", { exact: false })).toHaveCount(1);
    await composer.press("Enter");
    await expect(screen.getByText("Keep this", { exact: false }).first()).toBeVisible();

    // Wide enough for the topics to be a list beside the files; narrower, they are a menu.
    await browser.setViewport({ width: 1600, height: 1000 });
    await t3.open("/library");
    const files = screen.getByRole("list", "Files");
    // The notes are not files; the picture sent in the chat is.
    await expect(screen.getByRole("tab", "All 5")).toBeVisible();
    await expect(screen.getByRole("tab", "Images 2")).toBeVisible();
    await expect(files.getByText("Welcome.md")).toBeHidden();
    await app.screenshot("library-all");

    await screen.getByRole("tab", "Images 2").tap();
    await expect(files.getByRole("button", "Open tram.png")).toBeVisible();
    await expect(files.getByRole("button", "Open image.png")).toBeVisible();
    await expect(files.getByText("prices.csv")).toBeHidden();

    await screen.getByRole("list", "Files by topic").getByRole("button", "Money 2").tap();
    await expect(files.getByText("electricity-bill.pdf")).toBeVisible();
    await expect(files.getByText("prices.csv")).toBeVisible();
    await expect(files.getByText("archive.zip")).toBeHidden();
    await app.screenshot("library-one-topic");

    await screen.getByRole("searchbox", "Search files").fill("nothing like this");
    await expect(screen.getByText("No files match")).toBeVisible();
    await screen.getByRole("searchbox", "Search files").fill("BILL");
    await expect(files.getByText("prices.csv")).toBeHidden();

    await files.getByText("electricity-bill.pdf").tap();
    // Notes shows the file and offers the way back.
    await expect(screen.getByRole("button", "Library")).toBeVisible();
    await app.screenshot("file-opened-in-notes");
    await screen.getByRole("button", "Library").tap();
    await expect(screen.getByRole("heading", "Library")).toBeVisible();
  },
);
