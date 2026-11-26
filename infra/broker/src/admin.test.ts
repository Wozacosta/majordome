import { describe, expect, it } from "vite-plus/test";

import { adminAccounts, type InviteAdminStore, type InviteRow, makeInviteAdmin } from "./admin.ts";
import { BrokerError } from "./errors.ts";

const START = 1_800_000_000_000;

function setup(rows: ReadonlyArray<InviteRow> = []) {
  const invites = new Map(rows.map((row) => [row.code, row]));
  const clock = { now: START };
  const store: InviteAdminStore = {
    list: async () => [...invites.values()],
    add: async ({ code, note, at }) => {
      invites.set(code, {
        code,
        note,
        createdAt: at,
        claimedAt: null,
        appName: null,
        removedAt: null,
      });
    },
    remove: async (code) => invites.get(code)?.claimedAt === null && invites.delete(code),
  };
  let seed = 0;
  const admin = makeInviteAdmin({
    store,
    urlFor: (name) => `https://${name}.example`,
    servers: async () => 3,
    maxServers: 10,
    now: () => clock.now,
    randomBytes: (length) => Uint8Array.from({ length }, () => seed++ % 256),
  });
  return { admin, invites, clock };
}

const codeOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => (error instanceof BrokerError ? error.code : String(error)),
  );

const used: InviteRow = {
  code: "used-1",
  note: "Ada",
  createdAt: START - 5000,
  claimedAt: START - 4000,
  appName: "majordome-aaaaaaaaaa",
  removedAt: null,
};

describe("invite admin", () => {
  it("makes an invite with a 128-bit code and the note of who it is for", async () => {
    const { admin, invites } = setup();
    const { code } = await admin.create("  Grace  ");
    expect(code).toMatch(/^[0-9a-f]{32}$/u);
    expect(invites.get(code)).toMatchObject({ note: "Grace", createdAt: START, claimedAt: null });
    expect((await admin.create("Linus")).code).not.toBe(code);
  });

  it("refuses an invite with no note, or one too long to read", async () => {
    const { admin, invites } = setup();
    expect(await codeOf(admin.create("   "))).toBe("invalid_request");
    expect(await codeOf(admin.create(undefined))).toBe("invalid_request");
    expect(await codeOf(admin.create("x".repeat(121)))).toBe("invalid_request");
    expect(invites.size).toBe(0);
  });

  it("lists invites newest first, with the address of a server that still runs", async () => {
    const removed = {
      ...used,
      code: "used-2",
      appName: "majordome-bbbbbbbbbb",
      createdAt: START - 9000,
      removedAt: START - 1000,
    };
    const { admin } = setup([removed, used]);
    await admin.create("Grace");
    const listed = await admin.list();
    expect(listed.invites.map((invite) => [invite.note, invite.url])).toEqual([
      ["Grace", null],
      ["Ada", "https://majordome-aaaaaaaaaa.example"],
      ["Ada", null],
    ]);
    expect(listed).toMatchObject({ servers: 3, maxServers: 10 });
  });

  it("takes back an unused invite, and never a used one", async () => {
    const { admin, invites } = setup([used]);
    const { code } = await admin.create("Grace");
    await admin.revoke(code);
    expect(invites.has(code)).toBe(false);
    expect(await codeOf(admin.revoke(code))).toBe("invalid_invite");
    expect(await codeOf(admin.revoke("used-1"))).toBe("invalid_invite");
    expect(await codeOf(admin.revoke(undefined))).toBe("invalid_invite");
    expect(invites.has("used-1")).toBe(true);
  });
});

describe("admin accounts", () => {
  it("reads the list of accounts, and names nobody when it is not set", () => {
    expect([...adminAccounts(" user_a, user_b ,")]).toEqual(["user_a", "user_b"]);
    expect(adminAccounts(undefined).size).toBe(0);
    expect(adminAccounts("").size).toBe(0);
  });
});
