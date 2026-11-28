import { describe, expect, it } from "vite-plus/test";

import { aiAccountsRow, computerStanding, majordomeSettingsCards } from "./settingsRows";

const mac = { id: "mac", label: "Mac mini", enabled: true, phase: "connected" };
const claude = { state: "ready", name: "Claude" } as const;
const base = {
  computers: [mac],
  ai: [claude],
  account: { email: "ana@example.com" },
  look: "Dark · English",
  voice: "On this phone",
  version: "0.10.89",
};

const shown = (input: Parameters<typeof majordomeSettingsCards>[0]) =>
  majordomeSettingsCards(input).map((card) =>
    card.rows.map((row) => [row.label, row.value ?? null, row.tone ?? null]),
  );

describe("majordomeSettingsCards", () => {
  it("shows nine rows in four cards, the computer and the Claude plan first with their state", () => {
    expect(shown({ ...base, notifications: "On" })).toEqual([
      [
        ["Mac mini", "Connected", "good"],
        ["Claude plan", "Signed in", "good"],
      ],
      [
        ["Your account", "ana@example.com", null],
        ["Passwords and keys", null, null],
      ],
      [
        ["Look and language", "Dark · English", null],
        ["Voice", "On this phone", null],
        ["Notifications", "On", null],
      ],
      [
        ["Archived chats", null, null],
        ["About", "0.10.89", null],
      ],
    ]);
  });

  it("opens each computer's own page from its row", () => {
    const [first] = majordomeSettingsCards({
      ...base,
      computers: [mac, { id: "server", label: "My server", enabled: true, phase: "error" }],
    });
    expect(first?.rows.map((row) => [row.label, row.value, row.opens])).toEqual([
      ["Mac mini", "Connected", { page: "SettingsEnvironmentDetail", environmentId: "mac" }],
      [
        "My server",
        "Can't be reached",
        { page: "SettingsEnvironmentDetail", environmentId: "server" },
      ],
      ["Claude plan", "Signed in", { page: "SettingsProviderAccounts" }],
    ]);
  });

  it("names no computer past three, and counts the connected ones", () => {
    const computers = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id,
      enabled: true,
      phase: id === "d" ? "offline" : "connected",
    }));
    const [first] = majordomeSettingsCards({ ...base, computers });
    expect(first?.rows[0]).toMatchObject({
      label: "Computers",
      value: "3 of 4 connected",
      opens: { page: "SettingsEnvironments" },
    });
    expect(first?.rows[0]?.tone).toBeUndefined();
  });

  it("offers to add a computer when there is none", () => {
    const [first] = majordomeSettingsCards({ ...base, computers: [], ai: [] });
    expect(first?.rows.map((row) => [row.label, row.value ?? null])).toEqual([
      ["Add a computer", null],
      ["AI accounts", null],
    ]);
  });

  it("asks for a sign-in, and leaves the account out of a build that has none", () => {
    const cards = shown({ ...base, ai: [{ state: "signIn" }], account: null });
    expect(cards[0]?.[1]).toEqual(["AI accounts", "Sign in", "warning"]);
    expect(cards[1]).toEqual([["Passwords and keys", null, null]]);
    expect(shown({ ...base, account: { email: null } })[1]?.[0]).toEqual([
      "Your account",
      "Sign in",
      null,
    ]);
  });

  it("names the row after the AI the computer answers with", () => {
    expect(shown({ ...base, ai: [{ state: "ready", name: "ChatGPT" }] })[0]?.[1]).toEqual([
      "ChatGPT plan",
      "Signed in",
      "good",
    ]);
  });
});

describe("computerStanding", () => {
  it("says how a computer stands in two words", () => {
    expect(computerStanding({ enabled: true, phase: "connected" }).value).toBe("Connected");
    expect(computerStanding({ enabled: true, phase: "reconnecting" })).toEqual({
      value: "Connecting…",
    });
    expect(computerStanding({ enabled: true, phase: "error" })).toEqual({
      value: "Can't be reached",
      tone: "warning",
    });
    expect(computerStanding({ enabled: false, phase: "connected" })).toEqual({
      value: "Switched off",
    });
  });
});

describe("aiAccountsRow", () => {
  it("is signed in only when every computer that has said is", () => {
    expect(aiAccountsRow([claude, { state: "checking" }]).value).toBe("Signed in");
    expect(aiAccountsRow([claude, { state: "signIn" }]).value).toBe("Sign in");
    expect(aiAccountsRow([claude, { state: "attention" }]).value).toBe("Needs a look");
    expect(aiAccountsRow([{ state: "checking" }])).toEqual({ label: "AI accounts" });
  });

  it("names no AI when the computers answer with different ones", () => {
    expect(aiAccountsRow([claude, { state: "ready", name: "Gemini" }])).toEqual({
      label: "AI accounts",
      value: "Signed in",
      tone: "good",
    });
    expect(aiAccountsRow([claude, { state: "signIn" }]).label).toBe("Claude plan");
  });
});
