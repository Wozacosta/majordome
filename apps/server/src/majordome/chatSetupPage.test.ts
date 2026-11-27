import { expect, it } from "vite-plus/test";

import { renderChatSetupPage } from "./chatSetupPage.ts";

const setup = (skills: Array<{ name: string; description: string }>) => ({
  startsWith: {
    instructions: [],
    skills,
    dailyNotes: [],
    otherTopics: [],
    otherTopicsTotal: 0,
  },
  canUse: {},
  canReach: { computer: "Home Mac", savedKeys: [], privateDocuments: [] },
});

it("lists skills by name when a description is long, each name opening onto its own", () => {
  const long = "Files a receipt under the right month, renames it and adds a line to the ledger.";
  const { html } = renderChatSetupPage({
    setup: setup([
      { name: "file-receipts", description: long },
      { name: "daily", description: "" },
    ]),
  });
  expect(html).toContain(
    `<details class="row"><summary><b>file-receipts</b><svg class="caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><span>${long}</span></details>`,
  );
  expect(html).toContain('<div class="row"><b>daily</b></div>');
});

it("keeps short notes beside their names", () => {
  const { html } = renderChatSetupPage({
    setup: setup([{ name: "recap", description: "Writes Friday's recap." }]),
  });
  expect(html).toContain('<div class="row"><b>recap</b><span>Writes Friday\'s recap.</span></div>');
});
