import { BrokerError } from "./errors.ts";
import { verifyProof } from "./proof.ts";

export const TUNNEL_NAME_PREFIX = "majord-";
export const TUNNEL_PAGE_SIZE = 100;
const LABEL_LENGTH = 8;
// No 0/o, 1/l/i: an address is read aloud and typed by hand.
const LABEL_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const RESERVED_LABELS = new Set(["broker", "www", "api", "mail", "admin", "abuse", "status"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_MS = 14 * DAY_MS;
const NEVER_CONNECTED_MS = DAY_MS;
// Workers' free plan allows 50 subrequests per run. A run spends 1 query and up
// to 3 list calls, then at most 5 per address: 4 + 8 * 5 = 44.
export const REAP_BATCH = 8;
const REAP_LIST_PAGES = 3;

export interface AddressRow {
  readonly label: string;
  readonly identity: string;
  readonly port: number;
  readonly tunnelId: string | null;
  readonly dnsRecordId: string | null;
  readonly clientIp: string;
  readonly createdAt: number;
  readonly blocked: boolean;
  readonly reapedAt: number | null;
}

export interface AddressStore {
  /** `blocked` also covers reaped rows, so a block outlives the address. */
  readonly forIdentity: (
    identity: string,
  ) => Promise<{ readonly live: AddressRow | null; readonly blocked: boolean }>;
  readonly usage: (input: { readonly clientIp: string; readonly since: number }) => Promise<{
    readonly live: number;
    readonly createdByIp: number;
    readonly createdTotal: number;
  }>;
  /** False when the label was ever used, or the identity already has a live address. */
  readonly insert: (row: AddressRow) => Promise<boolean>;
  readonly update: (
    label: string,
    patch: Partial<Pick<AddressRow, "port" | "tunnelId" | "dnsRecordId">>,
  ) => Promise<void>;
  readonly markReaped: (label: string, at: number) => Promise<void>;
  readonly listLive: () => Promise<ReadonlyArray<AddressRow>>;
}

export interface Tunnel {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
  readonly createdAt: number | null;
  readonly connsActiveAt: number | null;
  readonly connsInactiveAt: number | null;
}

export interface CloudflareClient {
  readonly createTunnel: (name: string) => Promise<string>;
  readonly findTunnel: (name: string) => Promise<string | null>;
  readonly listTunnels: (namePrefix: string, page: number) => Promise<ReadonlyArray<Tunnel>>;
  readonly putIngress: (tunnelId: string, hostname: string, port: number) => Promise<void>;
  readonly getToken: (tunnelId: string) => Promise<string>;
  readonly deleteTunnel: (tunnelId: string) => Promise<void>;
  readonly cleanupConnections: (tunnelId: string) => Promise<void>;
  readonly createDnsRecord: (hostname: string, tunnelId: string) => Promise<string>;
  readonly findDnsRecords: (hostname: string) => Promise<ReadonlyArray<string>>;
  readonly deleteDnsRecord: (dnsRecordId: string) => Promise<void>;
}

export class CloudflareError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const hasStatus = (error: unknown, status: number) =>
  error instanceof CloudflareError && error.status === status;

// Cloudflare refuses to delete a tunnel while a connector is attached.
const isTunnelInUse = (error: unknown) =>
  error instanceof CloudflareError && error.message.includes("active connections");

async function ignoreNotFound(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
  }
}

export interface BrokerConfig {
  readonly zoneName: string;
  readonly maxNewPerIpPerDay: number;
  readonly maxNewPerDay: number;
  readonly maxLive: number;
}

export interface BrokerDeps {
  readonly store: AddressStore;
  readonly cloudflare: CloudflareClient;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly config: BrokerConfig;
}

export interface AddressRequest {
  readonly publicKey: string;
  readonly proof: string;
  readonly clientIp: string;
}

export interface ClaimedAddress {
  readonly hostname: string;
  readonly url: string;
  readonly connectorToken: string;
  readonly tunnelId: string;
}

/**
 * What the per-client limits count by: an IPv4 address, or the /64 an IPv6 address is in, since
 * one connection is handed a whole /64 and can use any address in it.
 */
export function clientBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(ip);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const before = head === "" ? [] : head.split(":");
  const after = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = tail === undefined ? 0 : Math.max(0, 8 - before.length - after.length);
  const network = [...before, ...Array<string>(zeros).fill("0"), ...after]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/u, ""));
  return `${network.join(":")}::/64`;
}

export function generateLabel(randomBytes: (length: number) => Uint8Array): string {
  for (;;) {
    let label = "";
    while (label.length < LABEL_LENGTH) {
      for (const byte of randomBytes(LABEL_LENGTH * 2)) {
        // 31 symbols: drop the 32nd value instead of folding it in, which would bias one letter.
        const symbol = LABEL_ALPHABET[byte & 31];
        if (symbol !== undefined && label.length < LABEL_LENGTH) label += symbol;
      }
    }
    if (!RESERVED_LABELS.has(label)) return label;
  }
}

export interface ReapCandidate {
  readonly row: AddressRow;
  readonly tunnelId: string | null;
  /** Blocked addresses are removed even while their computer is connected. */
  readonly force: boolean;
}

/** Picks the live addresses to remove. A tunnel no row knows about is never picked. */
export function selectReapable(input: {
  readonly rows: ReadonlyArray<AddressRow>;
  readonly tunnels: ReadonlyArray<Tunnel>;
  readonly now: number;
}): ReadonlyArray<ReapCandidate> {
  const tunnelsByName = new Map(
    input.tunnels
      .filter((tunnel) => tunnel.name.startsWith(TUNNEL_NAME_PREFIX))
      .map((tunnel) => [tunnel.name, tunnel]),
  );
  const candidates: Array<ReapCandidate> = [];
  for (const row of input.rows) {
    if (row.reapedAt !== null) continue;
    const listed = tunnelsByName.get(TUNNEL_NAME_PREFIX + row.label);
    const tunnel =
      listed !== undefined && (row.tunnelId === null || row.tunnelId === listed.id)
        ? listed
        : undefined;
    if (row.blocked) {
      candidates.push({ row, tunnelId: row.tunnelId ?? tunnel?.id ?? null, force: true });
      continue;
    }
    if (tunnel === undefined) {
      // A claim that failed before its tunnel was recorded and was never retried.
      if (row.tunnelId === null && row.createdAt <= input.now - NEVER_CONNECTED_MS) {
        candidates.push({ row, tunnelId: null, force: false });
      }
      continue;
    }
    if (tunnel.status === "healthy" || tunnel.status === "degraded") continue;
    const neverConnected = tunnel.connsActiveAt === null && tunnel.connsInactiveAt === null;
    const expired = neverConnected
      ? tunnel.createdAt !== null && tunnel.createdAt <= input.now - NEVER_CONNECTED_MS
      : tunnel.connsInactiveAt !== null && tunnel.connsInactiveAt <= input.now - IDLE_MS;
    if (expired) candidates.push({ row, tunnelId: tunnel.id, force: false });
  }
  return candidates;
}

export function makeBroker(deps: BrokerDeps) {
  const { store, cloudflare, config } = deps;
  const hostnameOf = (label: string) => `${label}.${config.zoneName}`;
  const nowSeconds = () => Math.floor(deps.now() / 1000);

  const allocate = async (identity: string, port: number, clientIp: string) => {
    const now = deps.now();
    const usage = await store.usage({ clientIp, since: now - DAY_MS });
    if (usage.live >= config.maxLive) {
      throw new BrokerError("full", "No addresses are free right now. Try again in a few days.");
    }
    if (
      usage.createdByIp >= config.maxNewPerIpPerDay ||
      usage.createdTotal >= config.maxNewPerDay
    ) {
      throw new BrokerError("rate_limited", "Too many new addresses today. Try again tomorrow.");
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const row: AddressRow = {
        label: generateLabel(deps.randomBytes),
        identity,
        port,
        tunnelId: null,
        dnsRecordId: null,
        clientIp,
        createdAt: now,
        blocked: false,
        reapedAt: null,
      };
      if (await store.insert(row)) return { row, fresh: true };
      const concurrent = (await store.forIdentity(identity)).live;
      if (concurrent !== null) return { row: concurrent, fresh: false };
    }
    throw new BrokerError("upstream", "Could not pick a free address. Try again.");
  };

  const createDnsRecord = async (hostname: string, tunnelId: string, fresh: boolean) => {
    try {
      return await cloudflare.createDnsRecord(hostname, tunnelId);
    } catch (error) {
      // An earlier claim may have created the record and failed before recording it.
      const stale = fresh || hasStatus(error, 429) ? [] : await cloudflare.findDnsRecords(hostname);
      if (stale.length === 0) throw error;
      for (const dnsRecordId of stale)
        await ignoreNotFound(cloudflare.deleteDnsRecord(dnsRecordId));
      return await cloudflare.createDnsRecord(hostname, tunnelId);
    }
  };

  const provision = async (row: AddressRow, port: number, fresh: boolean) => {
    const hostname = hostnameOf(row.label);
    const name = TUNNEL_NAME_PREFIX + row.label;
    // Only a retried claim can find its tunnel already there; a new label cannot.
    const tunnelId =
      (fresh ? null : await cloudflare.findTunnel(name)) ?? (await cloudflare.createTunnel(name));
    await cloudflare.putIngress(tunnelId, hostname, port);
    if (row.dnsRecordId !== null) await ignoreNotFound(cloudflare.deleteDnsRecord(row.dnsRecordId));
    await store.update(row.label, { tunnelId, port, dnsRecordId: null });
    const dnsRecordId = await createDnsRecord(hostname, tunnelId, fresh);
    await store.update(row.label, { dnsRecordId });
    return { tunnelId, connectorToken: await cloudflare.getToken(tunnelId) };
  };

  const connect = async (row: AddressRow, port: number, fresh: boolean) => {
    if (!fresh && row.tunnelId !== null && row.dnsRecordId !== null) {
      try {
        if (row.port !== port) {
          await cloudflare.putIngress(row.tunnelId, hostnameOf(row.label), port);
          await store.update(row.label, { port });
        }
        return { tunnelId: row.tunnelId, connectorToken: await cloudflare.getToken(row.tunnelId) };
      } catch (error) {
        // The tunnel was deleted meanwhile: rebuild it under the same label.
        if (!hasStatus(error, 404)) throw error;
      }
    }
    return provision(row, port, fresh);
  };

  /** False when the tunnel is in use and `force` is off. */
  const deleteTunnel = async (tunnelId: string, force: boolean) => {
    try {
      await ignoreNotFound(cloudflare.deleteTunnel(tunnelId));
      return true;
    } catch (error) {
      if (!isTunnelInUse(error)) throw error;
      if (!force) return false;
    }
    await ignoreNotFound(cloudflare.cleanupConnections(tunnelId));
    await ignoreNotFound(cloudflare.deleteTunnel(tunnelId));
    return true;
  };

  const remove = async (row: AddressRow, tunnelId: string | null, force: boolean) => {
    if (tunnelId !== null && !(await deleteTunnel(tunnelId, force))) return false;
    if (row.dnsRecordId !== null) {
      try {
        await ignoreNotFound(cloudflare.deleteDnsRecord(row.dnsRecordId));
      } catch (error) {
        // Forget the deleted tunnel, or the reaper would wait for it to show up idle.
        if (row.tunnelId !== null) await store.update(row.label, { tunnelId: null });
        throw error;
      }
    }
    await store.markReaped(row.label, deps.now());
    return true;
  };

  return {
    claim: async (request: AddressRequest): Promise<ClaimedAddress> => {
      const { identity, port } = await verifyProof({
        publicKey: request.publicKey,
        proof: request.proof,
        action: "claim",
        nowSeconds: nowSeconds(),
      });
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65_535) {
        throw new BrokerError("invalid_request", "port must be a whole number from 1024 to 65535.");
      }
      const known = await store.forIdentity(identity);
      if (known.blocked) {
        throw new BrokerError("blocked", "This computer may not have an address.");
      }
      const { row, fresh } =
        known.live === null
          ? await allocate(identity, port, request.clientIp)
          : { row: known.live, fresh: false };
      const { tunnelId, connectorToken } = await connect(row, port, fresh);
      const hostname = hostnameOf(row.label);
      return { hostname, url: `https://${hostname}`, connectorToken, tunnelId };
    },

    release: async (request: AddressRequest): Promise<void> => {
      const { identity } = await verifyProof({
        publicKey: request.publicKey,
        proof: request.proof,
        action: "release",
        nowSeconds: nowSeconds(),
      });
      const row = (await store.forIdentity(identity)).live;
      if (row === null) return;
      const tunnelId =
        row.tunnelId ?? (await cloudflare.findTunnel(TUNNEL_NAME_PREFIX + row.label));
      await remove(row, tunnelId, true);
    },

    reap: async () => {
      const now = deps.now();
      const rows = await store.listLive();
      const tunnels: Array<Tunnel> = [];
      for (let page = 1; rows.length > 0 && page <= REAP_LIST_PAGES; page++) {
        const listed = await cloudflare.listTunnels(TUNNEL_NAME_PREFIX, page);
        tunnels.push(...listed);
        if (listed.length < TUNNEL_PAGE_SIZE) break;
      }
      const candidates = selectReapable({ rows, tunnels, now });
      // Start somewhere new each hour so one address that keeps failing cannot block the rest.
      const offset =
        candidates.length === 0
          ? 0
          : (Math.floor(now / (60 * 60 * 1000)) * REAP_BATCH) % candidates.length;
      const batch = [...candidates.slice(offset), ...candidates.slice(0, offset)].slice(
        0,
        REAP_BATCH,
      );
      let reaped = 0;
      let failed = 0;
      for (const candidate of batch) {
        try {
          if (await remove(candidate.row, candidate.tunnelId, candidate.force)) reaped += 1;
        } catch (error) {
          failed += 1;
          console.warn("Could not remove address", candidate.row.label, error);
          // The limit is account-wide: every further call would fail and extend it.
          if (hasStatus(error, 429)) break;
        }
      }
      return { candidates: candidates.length, reaped, failed };
    },
  };
}

export type Broker = ReturnType<typeof makeBroker>;
