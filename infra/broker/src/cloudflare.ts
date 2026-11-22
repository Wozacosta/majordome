import { type CloudflareClient, CloudflareError, type Tunnel, TUNNEL_PAGE_SIZE } from "./broker.ts";

interface Envelope {
  readonly success?: boolean;
  readonly errors?: ReadonlyArray<{ readonly code?: number; readonly message?: string }>;
  readonly result?: unknown;
}

interface TunnelResult {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string | null;
  readonly created_at?: string | null;
  readonly conns_active_at?: string | null;
  readonly conns_inactive_at?: string | null;
}

const timestamp = (value: string | null | undefined) => {
  const millis = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(millis) ? null : millis;
};

export function makeCloudflareClient(config: {
  readonly apiToken: string;
  readonly accountId: string;
  readonly zoneId: string;
}): CloudflareClient {
  const tunnelsPath = `/accounts/${config.accountId}/cfd_tunnel`;
  const dnsPath = `/zones/${config.zoneId}/dns_records`;

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
    const envelope = (await response.json().catch(() => ({}))) as Envelope;
    if (!response.ok || envelope.success !== true) {
      const detail = (envelope.errors ?? [])
        .map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim())
        .join("; ");
      throw new CloudflareError(
        response.status,
        `Cloudflare ${method} ${path.split("?")[0]} failed (${response.status}): ${detail}`,
        response.headers.get("retry-after"),
      );
    }
    return envelope.result;
  };

  const listTunnels = async (query: Record<string, string>): Promise<ReadonlyArray<Tunnel>> => {
    const search = new URLSearchParams({ is_deleted: "false", ...query });
    const result = (await call("GET", `${tunnelsPath}?${search}`)) as
      | ReadonlyArray<TunnelResult>
      | null
      | undefined;
    return (result ?? []).flatMap((tunnel) =>
      typeof tunnel.id === "string" && typeof tunnel.name === "string"
        ? [
            {
              id: tunnel.id,
              name: tunnel.name,
              status: tunnel.status ?? null,
              createdAt: timestamp(tunnel.created_at),
              connsActiveAt: timestamp(tunnel.conns_active_at),
              connsInactiveAt: timestamp(tunnel.conns_inactive_at),
            },
          ]
        : [],
    );
  };

  const resultId = (result: unknown, what: string) => {
    const id = (result as { readonly id?: unknown } | null)?.id;
    if (typeof id !== "string")
      throw new CloudflareError(502, `Cloudflare returned no ${what} id.`);
    return id;
  };

  return {
    createTunnel: async (name) =>
      resultId(await call("POST", tunnelsPath, { name, config_src: "cloudflare" }), "tunnel"),
    findTunnel: async (name) =>
      (await listTunnels({ name })).find((tunnel) => tunnel.name === name)?.id ?? null,
    listTunnels: (namePrefix, page) =>
      listTunnels({
        include_prefix: namePrefix,
        page: String(page),
        per_page: String(TUNNEL_PAGE_SIZE),
      }),
    putIngress: async (tunnelId, hostname, port) => {
      await call("PUT", `${tunnelsPath}/${tunnelId}/configurations`, {
        config: {
          ingress: [
            { hostname, service: `http://localhost:${port}` },
            { service: "http_status:404" },
          ],
        },
      });
    },
    getToken: async (tunnelId) => {
      const token = await call("GET", `${tunnelsPath}/${tunnelId}/token`);
      if (typeof token !== "string")
        throw new CloudflareError(502, "Cloudflare returned no token.");
      return token;
    },
    deleteTunnel: async (tunnelId) => {
      await call("DELETE", `${tunnelsPath}/${tunnelId}`);
    },
    cleanupConnections: async (tunnelId) => {
      await call("DELETE", `${tunnelsPath}/${tunnelId}/connections`);
    },
    createDnsRecord: async (hostname, tunnelId) =>
      resultId(
        await call("POST", dnsPath, {
          type: "CNAME",
          name: hostname,
          content: `${tunnelId}.cfargotunnel.com`,
          ttl: 1,
          proxied: true,
        }),
        "DNS record",
      ),
    findDnsRecords: async (hostname) => {
      const search = new URLSearchParams({ name: hostname, type: "CNAME" });
      const result = (await call("GET", `${dnsPath}?${search}`)) as
        | ReadonlyArray<{ readonly id?: string; readonly name?: string }>
        | null
        | undefined;
      return (result ?? []).flatMap((record) =>
        typeof record.id === "string" && record.name === hostname ? [record.id] : [],
      );
    },
    deleteDnsRecord: async (dnsRecordId) => {
      await call("DELETE", `${dnsPath}/${dnsRecordId}`);
    },
  };
}
