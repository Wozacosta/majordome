import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "Today lists a chat under Working while it is answered, then under Needs you until it is read",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    await t3.thread({
      project: notes,
      title: "Plan the trip",
      messages: ["Where to?"],
      model: "question",
    });
    await t3.open("/");

    // A chat the assistant asked a question in waits for the owner.
    const needsYou = screen.getByRole("region", "Needs you");
    const working = screen.getByRole("region", "Working");
    await expect(
      needsYou
        .getByRole("link", "Plan the trip", { exact: false })
        .getByText("Waiting for your answer"),
    ).toBeVisible();
    await expect(working).toBeHidden();

    // A chat started here shows as being worked on once the owner comes back to Today.
    const box = screen.getByRole("textbox", "Ask anything, or tell me what to remember");
    await box.fill("Give me a short tour");
    await box.press("Enter");
    await expect(screen.getByRole("button", "Stop generation")).toBeVisible();
    await screen.getByRole("link", "Today", { exact: true }).tap();
    const tour = { exact: false } as const;
    await expect(working.getByRole("link", "Give me a short tour", tour)).toBeVisible();
    await app.screenshot("working");

    // Its answer waits under Needs you until the chat is opened.
    const answered = needsYou.getByRole("link", "Give me a short tour", tour);
    await expect(answered).toBeVisible({ timeout: 100_000 });
    await expect(needsYou.getByText("New reply")).toBeVisible();
    await expect(working).toBeHidden();
    await app.screenshot("needs-you");

    await answered.tap();
    await expect(box).toBeHidden();
    await screen.getByRole("link", "Today", { exact: true }).tap();
    await expect(needsYou.getByRole("link", "Plan the trip", { exact: false })).toBeVisible();
    await expect(answered).toBeHidden();
    await app.screenshot("read");
  },
);
