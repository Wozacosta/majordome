import { expect } from "e2e";

import { files, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const GONE_SERVER = "b70b0b67-0000-4000-8000-00000000gone";

test(
  "When the server that kept the conversations is gone, the notice lets this computer take over",
  WEB,
  async ({ t3, app, screen }) => {
    // The notes still name a server that no longer exists, as after a hosted server is removed.
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/runner": `${GONE_SERVER}\n`,
    });
    await t3.open();

    const newChat = screen.getByRole("button", "New chat", { exact: true }).first();
    await newChat.tap({ timeout: 120_000 });
    await expect(screen.getByText("Your server can't be reached")).toBeVisible({ timeout: 60_000 });
    const takeOver = screen.getByRole("button", "Use this computer");
    await expect(takeOver).toBeVisible();
    await app.screenshot("server-gone-notice");

    await takeOver.tap();
    const question = screen.getByRole("alertdialog");
    await expect(
      question.getByText("new conversations are kept here", { exact: false }),
    ).toBeVisible();
    await app.screenshot("take-over-question");
    await question.getByRole("button", "Move routines here").tap();
    await expect(screen.getByText("Routines now run on this computer")).toBeVisible({
      timeout: 30_000,
    });
    expect((await files.read(`${notes}/.majordome/runner`)).trim()).not.toBe(GONE_SERVER);

    // Its routines are listed again, and a conversation starts here with no notice.
    await t3.open("/routines");
    await expect(
      screen.getByRole("list", "Routines", { exact: true }).getByText("Start my day", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole("button", "Move routines here")).toBeHidden();
    await app.screenshot("routines-run-here");
    await screen.getByRole("button", "New chat", { exact: true }).first().tap();
    await expect(screen.getByText("Your server can't be reached")).toBeHidden();
    await expect(screen.getByText("Still checking", { exact: false })).toBeHidden();
    await app.screenshot("chat-starts-here");
  },
);
