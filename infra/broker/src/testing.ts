import {
  type AddressRow,
  type AddressStore,
  type CloudflareClient,
  CloudflareError,
  makeBroker,
  type Tunnel,
  TUNNEL_PAGE_SIZE,
} from "./broker.ts";
import { PROOF_AUDIENCE, PROOF_TYP } from "./proof.ts";

export const START = 1_800_000_000_000;
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

export interface TestIdentity {
  readonly publicKey: string;
  readonly sign: (claims: Record<string, unknown>, typ?: string) => Promise<string>;
  readonly proof: (
    act: "claim" | "release",
    nowMs: number,
    claims?: Record<string, unknown>,
  ) => Promise<string>;
}

export async function makeIdentity(): Promise<TestIdentity> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer;
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(spki)))}\n-----END PUBLIC KEY-----\n`;
  const sign = async (claims: Record<string, unknown>, typ = PROOF_TYP) => {
    const signingInput = `${encodeJson({ alg: "EdDSA", typ })}.${encodeJson(claims)}`;
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      pair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  };
  return {
    publicKey,
    sign,
    proof: (act, nowMs, claims = {}) => {
      const iat = Math.floor(nowMs / 1000);
      return sign({ aud: PROOF_AUDIENCE, act, port: 3774, iat, exp: iat + 120, ...claims });
    },
  };
}

export function makeFakeStore() {
  const rows = new Map<string, AddressRow>();
  const patch = (label: string, change: Partial<AddressRow>) => {
    const row = rows.get(label);
    if (row !== undefined) rows.set(label, { ...row, ...change });
  };
  const store: AddressStore = {
    forIdentity: async (identity) => {
      const own = [...rows.values()].filter((row) => row.identity === identity);
      return {
        live: own.find((row) => row.reapedAt === null) ?? null,
        blocked: own.some((row) => row.blocked),
      };
    },
    usage: async ({ clientIp, since }) => {
      const recent = [...rows.values()].filter((row) => row.createdAt > since);
      return {
        live: [...rows.values()].filter((row) => row.reapedAt === null).length,
        createdByIp: recent.filter((row) => row.clientIp === clientIp).length,
        createdTotal: recent.length,
      };
    },
    insert: async (row) => {
      const taken =
        rows.has(row.label) ||
        [...rows.values()].some(
          (other) => other.identity === row.identity && other.reapedAt === null,
        );
      if (!taken) rows.set(row.label, row);
      return !taken;
    },
    update: async (label, change) => patch(label, change),
    markReaped: async (label, at) => patch(label, { reapedAt: at }),
    listLive: async () => [...rows.values()].filter((row) => row.reapedAt === null),
  };
  return { store, rows, patch };
}

export function makeFakeCloudflare(now: () => number) {
  const tunnels = new Map<string, Tunnel>();
  const ingress = new Map<string, { readonly hostname: string; readonly port: number }>();
  const dnsRecords = new Map<string, { readonly hostname: string; readonly tunnelId: string }>();
  const calls: Array<string> = [];
  let nextId = 0;
  const record = (call: string) => {
    calls.push(call);
  };
  const requireTunnel = (tunnelId: string) => {
    const tunnel = tunnels.get(tunnelId);
    if (tunnel === undefined) throw new CloudflareError(404, "Tunnel not found");
    return tunnel;
  };
  const isConnected = (tunnel: Tunnel) => tunnel.status === "healthy";
  const client: CloudflareClient = {
    createTunnel: async (name) => {
      record("createTunnel");
      const id = `tunnel-${++nextId}`;
      tunnels.set(id, {
        id,
        name,
        status: "inactive",
        createdAt: now(),
        connsActiveAt: null,
        connsInactiveAt: null,
      });
      return id;
    },
    findTunnel: async (name) => {
      record("findTunnel");
      return [...tunnels.values()].find((tunnel) => tunnel.name === name)?.id ?? null;
    },
    listTunnels: async (namePrefix, page) => {
      record("listTunnels");
      return [...tunnels.values()]
        .filter((tunnel) => tunnel.name.startsWith(namePrefix))
        .slice((page - 1) * TUNNEL_PAGE_SIZE, page * TUNNEL_PAGE_SIZE);
    },
    putIngress: async (tunnelId, hostname, port) => {
      record("putIngress");
      requireTunnel(tunnelId);
      ingress.set(tunnelId, { hostname, port });
    },
    getToken: async (tunnelId) => {
      record("getToken");
      requireTunnel(tunnelId);
      return `token-${tunnelId}-${calls.length}`;
    },
    deleteTunnel: async (tunnelId) => {
      record("deleteTunnel");
      if (isConnected(requireTunnel(tunnelId))) {
        throw new CloudflareError(400, "Cannot delete tunnel: it has active connections");
      }
      tunnels.delete(tunnelId);
    },
    cleanupConnections: async (tunnelId) => {
      record("cleanupConnections");
      tunnels.set(tunnelId, { ...requireTunnel(tunnelId), status: "down", connsInactiveAt: now() });
    },
    createDnsRecord: async (hostname, tunnelId) => {
      record("createDnsRecord");
      const id = `dns-${++nextId}`;
      dnsRecords.set(id, { hostname, tunnelId });
      return id;
    },
    findDnsRecords: async (hostname) => {
      record("findDnsRecords");
      return [...dnsRecords].flatMap(([id, entry]) => (entry.hostname === hostname ? [id] : []));
    },
    deleteDnsRecord: async (dnsRecordId) => {
      record("deleteDnsRecord");
      if (!dnsRecords.delete(dnsRecordId)) throw new CloudflareError(404, "Record not found");
    },
  };
  return {
    client,
    tunnels,
    ingress,
    dnsRecords,
    calls,
    setTunnel: (tunnelId: string, change: Partial<Tunnel>) => {
      tunnels.set(tunnelId, { ...requireTunnel(tunnelId), ...change });
    },
  };
}

export function setup(limits: { perIp?: number; perDay?: number; live?: number } = {}) {
  const clock = { now: START };
  const now = () => clock.now;
  const fakeStore = makeFakeStore();
  const cloudflare = makeFakeCloudflare(now);
  let seed = 1;
  const broker = makeBroker({
    store: fakeStore.store,
    cloudflare: cloudflare.client,
    now,
    randomBytes: (length) =>
      Uint8Array.from({ length }, () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed >>> 16;
      }),
    config: {
      zoneName: "majord.link",
      maxNewPerIpPerDay: limits.perIp ?? 3,
      maxNewPerDay: limits.perDay ?? 40,
      maxLive: limits.live ?? 180,
    },
  });
  const claim = async (identity: TestIdentity, clientIp = "203.0.113.1", port = 3774) =>
    broker.claim({
      publicKey: identity.publicKey,
      proof: await identity.proof("claim", clock.now, { port }),
      clientIp,
    });
  const release = async (identity: TestIdentity) =>
    broker.release({
      publicKey: identity.publicKey,
      proof: await identity.proof("release", clock.now),
      clientIp: "203.0.113.1",
    });
  return { broker, clock, cloudflare, claim, release, ...fakeStore };
}
