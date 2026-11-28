import { describe, expect, it } from "vite-plus/test";

import { isUnknownAccount, newTestEmail, testAccounts } from "./majordomeTesting.ts";

describe("test accounts", () => {
  it("are offered only by the development account service", () => {
    expect(testAccounts("pk_test_abc").map((account) => account.email)).toEqual([
      "majordome-dev+1+clerk_test@example.com",
      "majordome-dev+2+clerk_test@example.com",
      "majordome-dev+3+clerk_test@example.com",
    ]);
    expect(testAccounts("pk_live_abc")).toEqual([]);
    expect(testAccounts(null)).toEqual([]);
  });

  it("makes a new address each time", () => {
    expect(newTestEmail(1)).not.toBe(newTestEmail(2));
    expect(newTestEmail(1)).toMatch(/\+clerk_test@example\.com$/);
  });

  it("tells an address with no account from another refusal", () => {
    expect(isUnknownAccount({ errors: [{ code: "form_identifier_not_found" }] })).toBe(true);
    expect(isUnknownAccount({ errors: [{ code: "form_code_incorrect" }] })).toBe(false);
    expect(isUnknownAccount(new Error("offline"))).toBe(false);
  });
});
