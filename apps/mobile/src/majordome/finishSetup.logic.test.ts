import { expect, it } from "vite-plus/test";

import { claudeSetupRow } from "./finishSetup.logic";

it("offers the sign-in only where the phone may run it", () => {
  expect(claudeSetupRow("signIn", true, "your Majordome server").kind).toBe("signIn");
  expect(claudeSetupRow("signIn", false, "your Majordome server")).toEqual({
    kind: "elsewhere",
    text: "This phone isn't allowed to sign in. Do it on your Majordome server.",
  });
});

it.each(["install", "disabled", "attention"] as const)(
  "sends %s to the computer, which the phone cannot settle",
  (state) => {
    const row = claudeSetupRow(state, true, "Home Mac");
    expect(row.kind).toBe("elsewhere");
    expect(row.text).toContain("Home Mac");
  },
);

it("shows nothing to do while checking or once ready", () => {
  expect(claudeSetupRow("checking", true, "Home Mac").kind).toBe("checking");
  expect(claudeSetupRow("ready", true, "Home Mac").kind).toBe("ready");
});
