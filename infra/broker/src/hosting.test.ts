import { describe, expect, it } from "vite-plus/test";

import { BrokerError } from "./errors.ts";
import {
  type HostClient,
  HostError,
  type InviteStore,
  isServerName,
  makeHosting,
} from "./hosting.ts";

const START = 1_800_000_000_000;

function setup(options: { readonly maxServers?: number; readonly failCreate?: boolean } = {}) {
  const invites = new Map<string, { app: string | null }>([["welcome-1", { app: null }]]);
  const servers = new Map<string, Readonly<Record<string, string>>>();
  const deleted: Array<string> = [];
  const store: InviteStore = {
    claim: async ({ code, appName }) => {
      const invite = invites.get(code);
      if (invite === undefined || invite.app !== null) return false;
      invite.app = appName;
      return true;
    },
    release: async (code) => {
      const invite = invites.get(code);
      if (invite !== undefined) invite.app = null;
    },
    live: async () => [...invites.values()].filter((invite) => invite.app !== null).length,
  };
  const host: HostClient = {
    createServer: async ({ name, env }) => {
      if (options.failCreate) throw new HostError(422, "no capacity");
      servers.set(name, env);
      return { url: `https://${name}.example` };
    },
    deleteServer: async (name) => {
      deleted.push(name);
    },
    urlFor: (name) => `https://${name}.example`,
  };
  let seed = 0;
  const hosting = makeHosting({
    invites: store,
    host,
    now: () => START,
    randomBytes: (length) => Uint8Array.from({ length }, () => seed++ % 256),
    config: { namePrefix: "majordome-", maxServers: options.maxServers ?? 5 },
  });
  return { hosting, invites, servers, deleted };
}

const create = (hosting: ReturnType<typeof setup>["hosting"], invite: string) =>
  hosting.create({ invite, clientIp: "203.0.113.7" });

describe("hosted servers", () => {
  it("spends an invite on a server that says it is hosted and pairs once with its secret", async () => {
    const { hosting, servers } = setup();

    const server = await create(hosting, " welcome-1 ");

    const [name, env] = [...servers][0] ?? ["", {}];
    expect(name).toMatch(/^majordome-[a-hjkmnp-z2-9]{10}$/u);
    expect(server.url).toBe(`https://${name}.example`);
    expect(server.name).toBe(name);
    expect(env.MAJORDOME_HOSTED).toBe("1");
    // The server reads this format: `mjsetup-<expiry seconds>-<43 base64url characters>`.
    expect(env.MAJORDOME_SETUP_SECRET).toMatch(/^mjsetup-(\d{1,12})-[A-Za-z0-9_-]{43}$/u);
    expect(env.MAJORDOME_SETUP_SECRET).toContain(`-${START / 1000 + 24 * 60 * 60}-`);
    expect(server.pairingUrl).toBe(`${server.url}/pair#token=${env.MAJORDOME_SETUP_SECRET}`);
  });

  it("knows the names it makes from any other", () => {
    expect(isServerName("majordome-", "majordome-abcdefgh23")).toBe(true);
    expect(isServerName("majordome-", "majordome-abcdefgh2")).toBe(false);
    expect(isServerName("majordome-", "majordome-abcdefgh0l")).toBe(false);
    expect(isServerName("majordome-", "someone-else-app")).toBe(false);
  });

  it("refuses an unknown invite and a spent one with the same answer", async () => {
    const { hosting, servers } = setup();
    await create(hosting, "welcome-1");

    const errors = await Promise.all(
      ["welcome-1", "never-issued", ""].map((invite) =>
        create(hosting, invite).then(
          () => null,
          (error: unknown) => (error instanceof BrokerError ? error.code : String(error)),
        ),
      ),
    );

    expect(errors).toEqual(["invalid_invite", "invalid_invite", "invalid_invite"]);
    expect(servers.size).toBe(1);
  });

  it("gives the invite back and removes what was made when the host fails", async () => {
    const { hosting, invites, deleted } = setup({ failCreate: true });

    await expect(create(hosting, "welcome-1")).rejects.toBeInstanceOf(HostError);

    expect(invites.get("welcome-1")).toEqual({ app: null });
    expect(deleted).toHaveLength(1);
  });

  it("stops making servers at the cap, before spending the invite", async () => {
    const { hosting, invites } = setup({ maxServers: 0 });

    await expect(create(hosting, "welcome-1")).rejects.toMatchObject({ code: "full" });

    expect(invites.get("welcome-1")).toEqual({ app: null });
  });
});
