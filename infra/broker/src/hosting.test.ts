import { describe, expect, it, vi } from "vite-plus/test";

import { BrokerError } from "./errors.ts";
import { makeFlyHost } from "./fly.ts";
import {
  type HostClient,
  HostError,
  imageByDigest,
  type InviteStore,
  isServerName,
  makeHosting,
  releaseVersion,
  serverProgress,
  updateServers,
} from "./hosting.ts";

const START = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const IMAGE = `ghcr.io/wozacosta/majordome@sha256:${"ab".repeat(32)}`;

function setup(options: { readonly maxServers?: number; readonly failCreate?: boolean } = {}) {
  const invites = new Map<string, { app: string | null }>([["welcome-1", { app: null }]]);
  const servers = new Map<string, Readonly<Record<string, string>>>();
  const deleted: Array<string> = [];
  const images: Array<string> = [];
  const failures: Array<{ readonly clientIp: string; readonly at: number }> = [];
  const clock = { now: START };
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
    liveNames: async () => [...invites.values()].flatMap((invite) => invite.app ?? []),
    failures: async ({ clientIp, since }) =>
      failures.filter((failure) => failure.clientIp === clientIp && failure.at > since).length,
    recordFailure: async ({ clientIp, at }) => {
      failures.push({ clientIp, at });
    },
  };
  const host: HostClient = {
    createServer: async ({ name, env, image }) => {
      if (options.failCreate) throw new HostError(422, "no capacity");
      servers.set(name, env);
      images.push(image);
      return { url: `https://${name}.example` };
    },
    deleteServer: async (name) => {
      deleted.push(name);
    },
    urlFor: (name) => `https://${name}.example`,
    updateServer: async () => undefined,
    isSwitchedOn: async () => true,
    stopServer: async () => undefined,
    startServer: async () => undefined,
  };
  let seed = 0;
  const hosting = makeHosting({
    invites: store,
    host,
    image: async () => IMAGE,
    now: () => clock.now,
    randomBytes: (length) => Uint8Array.from({ length }, () => seed++ % 256),
    config: { namePrefix: "majordome-", maxServers: options.maxServers ?? 5 },
  });
  return { hosting, invites, servers, deleted, images, clock };
}

const create = (
  hosting: ReturnType<typeof setup>["hosting"],
  invite: string,
  ownerAccountId?: string,
  clientIp = "203.0.113.7",
) =>
  hosting.create({
    invite,
    clientIp,
    ...(ownerAccountId === undefined ? {} : { ownerAccountId }),
  });

describe("hosted servers", () => {
  it("spends an invite on a server that says it is hosted and pairs once with its secret", async () => {
    const { hosting, servers, images } = setup();

    const server = await create(hosting, " welcome-1 ");

    expect(images).toEqual([IMAGE]);
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

  it("makes the server the signed-in account's from its first start", async () => {
    const { hosting, servers } = setup();
    await create(hosting, "welcome-1", "user_owner");
    expect([...servers.values()][0]?.MAJORDOME_OWNER_ACCOUNT).toBe("user_owner");

    const unsigned = setup();
    await create(unsigned.hosting, "welcome-1");
    expect([...unsigned.servers.values()][0]).not.toHaveProperty("MAJORDOME_OWNER_ACCOUNT");
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

  it("stops a client guessing codes after ten wrong ones in a day", async () => {
    const { hosting, servers, clock } = setup();
    const guess = (invite: string, clientIp?: string) =>
      create(hosting, invite, undefined, clientIp).then(
        () => "made",
        (error: unknown) => (error instanceof BrokerError ? error.code : String(error)),
      );
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(await guess(`guess-${attempt}`)).toBe("invalid_invite");
    }

    expect(await guess("welcome-1")).toBe("rate_limited");
    expect(servers.size).toBe(0);
    expect(await guess("guess", "203.0.113.8")).toBe("invalid_invite");

    clock.now += DAY;
    expect(await guess("welcome-1")).toBe("made");
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

describe("a new server's progress", () => {
  const progress = (name: string, calls: Array<string>, answers = false) =>
    serverProgress({
      name,
      namePrefix: "majordome-",
      liveNames: async () => ["majordome-abcdefgh23"],
      host: {
        isSwitchedOn: async (server) => {
          calls.push(`host ${server}`);
          return true;
        },
      },
      answers: async (server) => {
        calls.push(`server ${server}`);
        return answers;
      },
    });

  it("asks nothing about a name this service did not make", async () => {
    const calls: Array<string> = [];

    for (const name of ["majordome-zzzzzzzz99", "someone-else-app", ""]) {
      expect(await progress(name, calls)).toEqual({ switchedOn: false, ready: false });
    }

    expect(calls).toEqual([]);
  });

  it("says a server it made is switched on, then ready", async () => {
    const calls: Array<string> = [];

    expect(await progress("majordome-abcdefgh23", calls)).toEqual({
      switchedOn: true,
      ready: false,
    });
    expect(await progress("majordome-abcdefgh23", [], true)).toEqual({
      switchedOn: true,
      ready: true,
    });
    expect(calls).toEqual(["server majordome-abcdefgh23", "host majordome-abcdefgh23"]);
  });
});

describe("the Fly host", () => {
  it("gives each server a private network of its own, HTTPS only, on the image it is handed", async () => {
    const sent: Array<{ readonly path: string; readonly body: Record<string, unknown> }> = [];
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ path: new URL(String(input)).pathname, body });
      return Response.json({ id: "vol_1" });
    });
    const host = makeFlyHost({
      apiToken: "token",
      orgSlug: "majordome-hosted",
      region: "cdg",
      memoryMb: 2048,
      volumeGb: 3,
    });

    await host.createServer({ name: "majordome-abcdefgh23", env: {}, image: IMAGE });

    expect(sent[0]).toEqual({
      path: "/v1/apps",
      body: {
        app_name: "majordome-abcdefgh23",
        org_slug: "majordome-hosted",
        network: "majordome-abcdefgh23",
      },
    });
    expect(sent.at(-1)?.body.config).toMatchObject({
      image: IMAGE,
      services: [
        {
          ports: [
            { port: 443, handlers: ["tls", "http"] },
            { port: 80, handlers: ["http"], force_https: true },
          ],
        },
      ],
    });
  });
});

describe("updating hosted servers", () => {
  it("restarts only the servers on another version, and leaves silent ones for next time", async () => {
    const versions: Record<string, string | null> = {
      old: "0.10.29",
      current: "0.10.30",
      asleep: null,
      refused: "0.10.28",
    };
    const restarted: Array<string> = [];

    const report = await updateServers({
      names: Object.keys(versions),
      latestVersion: "0.10.30",
      image: IMAGE,
      versionOf: async (name) => versions[name] ?? null,
      host: {
        updateServer: async (name, image) => {
          if (name === "refused") throw new HostError(422, "no capacity");
          restarted.push(`${name} on ${image}`);
        },
      },
    });

    expect(restarted).toEqual([`old on ${IMAGE}`]);
    expect(report).toEqual({ updated: ["old"], current: 1, skipped: ["asleep", "refused"] });
  });

  it("reads the latest version from where the releases page redirects", () => {
    expect(releaseVersion("https://github.com/Wozacosta/majordome/releases/tag/v0.10.30")).toBe(
      "0.10.30",
    );
    expect(releaseVersion("https://github.com/Wozacosta/majordome/releases")).toBeNull();
    expect(releaseVersion(null)).toBeNull();
  });

  it("names the image by the digest a release carries, and by nothing else", () => {
    const digest = `sha256:${"ab".repeat(32)}`;
    expect(imageByDigest("ghcr.io/wozacosta/majordome", `${digest}\n`)).toBe(IMAGE);
    expect(imageByDigest("ghcr.io/wozacosta/majordome:latest", digest)).toBe(IMAGE);
    expect(imageByDigest("localhost:5000/majordome", digest)).toBe(
      `localhost:5000/majordome@${digest}`,
    );
    for (const other of ["latest", "sha256:abc", `${digest} evil`, "<html>Not Found</html>", ""]) {
      expect(imageByDigest("ghcr.io/wozacosta/majordome", other)).toBeNull();
    }
  });
});
