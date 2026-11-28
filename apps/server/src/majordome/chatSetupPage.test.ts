import { expect, it } from "vite-plus/test";

import { chatConnections, renderChatSetupPage } from "./chatSetupPage.ts";

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

it("names the note about the owner, and says so when it has not been started", () => {
  const withNote = (aboutYou: { note?: string }) =>
    renderChatSetupPage({
      setup: { ...setup([]), startsWith: { ...setup([]).startsWith, aboutYou } },
    }).html;
  expect(withNote({ note: "me.md" })).toMatch(/About you[^]{0,200}me\.md/);
  expect(withNote({})).toMatch(/About you[^]{0,200}Nothing yet/);
  expect(renderChatSetupPage({ setup: setup([]) }).html).not.toContain("About you");
});

it("lists the apps connected through Majordome for an AI that cannot say what it has", () => {
  const apps = [
    { name: "Granola", state: "connected" },
    { name: "Linear", state: "needs-sign-in" },
  ];
  expect(chatConnections({ apps, account: null })).toEqual([
    { name: "Granola", status: "connected" },
    { name: "Linear", status: "needs-auth" },
  ]);
  expect(chatConnections({ apps: [], account: null })).toBeUndefined();
});

it("names an app once when the AI account brings its own copy of it", () => {
  expect(
    chatConnections({
      apps: [{ name: "Granola", state: "connected" }],
      account: [
        { name: "claude.ai Granola", status: "needs-auth" },
        { name: "claude.ai Gmail", status: "connected" },
      ],
    }),
  ).toEqual([
    { name: "Granola", status: "connected" },
    { name: "claude.ai Gmail", status: "connected" },
  ]);
  expect(chatConnections({ apps: [], account: [] })).toEqual([]);
});
