import { describe, expect, it } from "vite-plus/test";

import { makeWaitlist, type WaitlistStore } from "./waitlist.ts";

const START = 1_800_000_000_000;

function setup(maxPerIpPerDay = 4) {
  const rows: Array<Parameters<WaitlistStore["add"]>[0]> = [];
  const store: WaitlistStore = {
    addedByIp: async ({ clientIp, since }) =>
      rows.filter((row) => row.clientIp === clientIp && row.createdAt > since).length,
    add: async (row) => {
      const listed = rows.some(
        (other) => other.email === row.email && other.platform === row.platform,
      );
      if (!listed) rows.push(row);
    },
  };
  return { rows, waitlist: makeWaitlist({ store, now: () => START, maxPerIpPerDay }) };
}

describe("waitlist", () => {
  it("keeps one row per email and platform, with the email in one spelling", async () => {
    const { rows, waitlist } = setup();
    await waitlist.join({
      email: "  Ada@Example.com ",
      platforms: ["linux", "windows", "linux"],
      clientIp: "1.1.1.1",
    });
    await waitlist.join({ email: "ada@example.com", platforms: ["linux"], clientIp: "1.1.1.1" });
    expect(rows.map((row) => [row.email, row.platform])).toEqual([
      ["ada@example.com", "linux"],
      ["ada@example.com", "windows"],
    ]);
  });

  it.each([
    { email: "not-an-email", platforms: ["linux"] },
    { email: 42, platforms: ["linux"] },
    { email: `${"a".repeat(250)}@example.com`, platforms: ["linux"] },
    { email: "ada@example.com", platforms: [] },
    { email: "ada@example.com", platforms: ["mac"] },
    { email: "ada@example.com", platforms: "linux" },
  ])("refuses $email for $platforms", async ({ email, platforms }) => {
    const { rows, waitlist } = setup();
    await expect(waitlist.join({ email, platforms, clientIp: "1.1.1.1" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(rows).toEqual([]);
  });

  it("stops one address from filling the list, without stopping the others", async () => {
    const { rows, waitlist } = setup(2);
    const both = ["linux", "windows"];
    await waitlist.join({ email: "a@example.com", platforms: both, clientIp: "1.1.1.1" });
    await expect(
      waitlist.join({ email: "b@example.com", platforms: both, clientIp: "1.1.1.1" }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    await waitlist.join({ email: "c@example.com", platforms: ["linux"], clientIp: "2.2.2.2" });
    expect(rows.map((row) => row.email)).toEqual([
      "a@example.com",
      "a@example.com",
      "c@example.com",
    ]);
  });
});
