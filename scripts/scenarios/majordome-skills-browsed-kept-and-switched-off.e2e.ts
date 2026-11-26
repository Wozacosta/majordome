import { expect } from "e2e";

import { files, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const skill = (name: string, when: string, steps: string) =>
  `---\nname: ${name}\ndescription: ${when}\n---\n\n${steps}\n`;

test(
  "Skills opens from More, is searched and read, and a skill is kept, switched off and used again",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      // "recap" and "todo" are names Majordome's own skills have; "tax-letter" is nobody's.
      ".agents/skills/recap/SKILL.md": skill("recap", "Use to wrap up a session.", "Write it."),
      ".agents/skills/todo/SKILL.md": skill("todo", "Use to manage the task list.", "Read it."),
      ".agents/skills/tax-letter/SKILL.md": skill(
        "tax-letter",
        "Use to answer the tax office.",
        "Draft the reply.",
      ),
      ".agents/proposed-skills/file-receipts/SKILL.md": skill(
        "file-receipts",
        "Use when a receipt is dropped.",
        "# Filing a receipt\n\n1. Find the **total**.\n2. Rename the scan.",
      ),
    });
    await t3.open();
    await screen.getByRole("button", "More").tap();
    await screen.getByRole("link", "Skills").tap();
    await expect(screen.getByRole("heading", "Skills", { level: 1 })).toBeVisible();

    const waiting = screen.getByRole("list", "Waiting for your yes");
    const inUse = screen.getByRole("list", "In use");
    const off = screen.getByRole("list", "Off");
    await expect(screen.getByRole("tab", "All 4")).toBeVisible();
    await expect(screen.getByRole("tab", "By your assistant 1")).toBeVisible();
    await expect(screen.getByRole("tab", "From Majordome 2")).toBeVisible();
    await expect(screen.getByRole("tab", "Other 1")).toBeVisible();
    await expect(waiting.getByText("Use when a receipt is dropped.")).toBeVisible();
    await expect(inUse.getByText("File receipts")).toBeHidden();

    // Its steps read as text, not as the file's marks.
    await waiting.getByRole("button", "Read File receipts").tap();
    await expect(waiting.getByRole("heading", "Filing a receipt")).toBeVisible();
    await app.screenshot("skill-opened");

    // A source that leaves out what waits says so, and the way back is one tap.
    await screen.getByRole("tab", "From Majordome 2").tap();
    await expect(inUse.getByText("Tax letter")).toBeHidden();
    await expect(screen.getByText("1 waiting for your yes is not shown.")).toBeVisible();
    await screen.getByRole("button", "Show all").tap();

    await waiting.getByRole("button", "Keep").tap();
    await expect(inUse.getByText("File receipts")).toBeVisible();
    await expect(waiting).toBeHidden();
    expect(await files.read(`${notes}/.agents/skills/file-receipts/SKILL.md`)).toContain(
      "Filing a receipt",
    );

    const search = screen.getByRole("searchbox", "Search skills");
    await search.fill("nothing like this");
    await expect(screen.getByText("No skills match.")).toBeVisible();
    await search.fill("WRAP");
    await expect(inUse.getByText("Recap")).toBeVisible();
    await expect(inUse.getByText("Tax letter")).toBeHidden();

    // Switched off, it is under Off, not back among what the assistant wrote and waits.
    await inUse.getByRole("button", "Stop using").tap();
    await expect(off.getByText("Recap")).toBeVisible();
    await expect(waiting).toBeHidden();
    expect(await files.list(`${notes}/.agents/skills`)).not.toContain("recap");
    await app.screenshot("skill-switched-off");

    await off.getByRole("button", "Use again").tap();
    await expect(inUse.getByText("Recap")).toBeVisible();
    await expect(off).toBeHidden();
    expect(await files.list(`${notes}/.agents/skills`)).toContain("recap");
  },
);
