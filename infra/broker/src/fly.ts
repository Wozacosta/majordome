import { type HostClient, HostError } from "./hosting.ts";

const SNAPSHOT_RETENTION_DAYS = 30;

interface FlyErrorBody {
  readonly error?: string;
  readonly status?: string;
}

/**
 * Fly.io as the host: one app per server, holding one volume and one Machine that runs the
 * Majordome image as it is. The app's `fly.dev` address is the server's address.
 */
export function makeFlyHost(config: {
  readonly apiToken: string;
  readonly orgSlug: string;
  readonly region: string;
  readonly memoryMb: number;
  /** Disk used as slow memory, for the minutes a chat and the browser need more than there is. */
  readonly swapMb: number;
  readonly volumeGb: number;
}): HostClient {
  // A token from `fly tokens create` already starts with its own scheme.
  const authorization = config.apiToken.startsWith("FlyV1 ")
    ? config.apiToken
    : `Bearer ${config.apiToken}`;

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`https://api.machines.dev/v1${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const detail = (parsed as FlyErrorBody | undefined)?.error ?? text.slice(0, 200);
      throw new HostError(
        response.status,
        `Fly ${method} ${path.split("?")[0]} failed (${response.status}): ${detail}`,
      );
    }
    return parsed;
  };

  const urlFor = (name: string) => `https://${name}.fly.dev`;

  interface Machine {
    readonly id?: string;
    readonly state?: string;
    readonly config?: { readonly services?: ReadonlyArray<unknown> };
  }
  const machinesOf = async (name: string) =>
    ((await call("GET", `/apps/${name}/machines`)) as ReadonlyArray<Machine> | undefined) ?? [];
  const services = [
    {
      protocol: "tcp",
      internal_port: 3773,
      ports: [
        { port: 443, handlers: ["tls", "http"] },
        { port: 80, handlers: ["http"], force_https: true },
      ],
    },
  ];

  return {
    urlFor,
    createServer: async ({ name, env, image }) => {
      const url = urlFor(name);
      const app = `/apps/${name}`;
      // A private network of its own: apps on an organization's default one reach each other.
      await call("POST", "/apps", { app_name: name, org_slug: config.orgSlug, network: name });
      // An app made through the API gets no address by itself.
      await call("POST", `${app}/ip_assignments`, { type: "shared_v4" });
      await call("POST", `${app}/ip_assignments`, { type: "v6" });
      // The volume first: a Machine made before it can land on another host and never attach.
      const volume = (await call("POST", `${app}/volumes`, {
        name: "data",
        region: config.region,
        size_gb: config.volumeGb,
        // Fly copies the disk every day. The copies are the only backup a customer has before
        // they connect one of their own, so they are kept a month, not the default five days.
        snapshot_retention: SNAPSHOT_RETENTION_DAYS,
      })) as { readonly id?: string } | undefined;
      if (typeof volume?.id !== "string") throw new HostError(502, "Fly returned no volume id.");
      await call("POST", `${app}/machines`, {
        name: "majordome",
        region: config.region,
        config: {
          image,
          env: { ...env, MAJORDOME_PUBLIC_URL: url },
          guest: { cpu_kind: "shared", cpus: 2, memory_mb: config.memoryMb },
          init: { swap_size_mb: config.swapMb },
          mounts: [{ volume: volume.id, path: "/data" }],
          restart: { policy: "always" },
          services,
        },
      });
      return { url };
    },
    isSwitchedOn: async (name) => {
      const machines = (await call("GET", `/apps/${name}/machines`)) as
        | ReadonlyArray<{ readonly state?: string }>
        | undefined;
      return (machines ?? []).some((machine) => machine.state === "started");
    },
    updateServer: async (name, image) => {
      const machines = (await call("GET", `/apps/${name}/machines`)) as
        | ReadonlyArray<{ readonly id?: string; readonly config?: Record<string, unknown> }>
        | undefined;
      for (const machine of machines ?? []) {
        if (typeof machine.id !== "string" || machine.config === undefined) continue;
        await call("POST", `/apps/${name}/machines/${machine.id}`, {
          config: { ...machine.config, image },
        });
      }
    },
    stopServer: async (name) => {
      for (const machine of await machinesOf(name)) {
        if (typeof machine.id !== "string") continue;
        const path = `/apps/${name}/machines/${machine.id}`;
        const reachable = (machine.config?.services ?? []).length > 0;
        if (!reachable && machine.state === "stopped") continue;
        if (reachable) {
          // Fly starts a stopped Machine when its address is visited, whatever `autostart` says
          // (seen 2026-11-24), so the address is taken away. Updating launches the Machine, so
          // this comes first and the stop last.
          await call("POST", path, { config: { ...machine.config, services: [] } });
          await call("GET", `${path}/wait?state=started&timeout=60`);
        }
        await call("POST", `${path}/stop`, {});
        await call("GET", `${path}/wait?state=stopped&timeout=60`);
      }
    },
    startServer: async (name) => {
      for (const machine of await machinesOf(name)) {
        if (typeof machine.id !== "string") continue;
        await call("POST", `/apps/${name}/machines/${machine.id}`, {
          config: { ...machine.config, services },
        });
      }
    },
    deleteServer: async (name) => {
      try {
        await call("DELETE", `/apps/${name}?force=true`);
      } catch (error) {
        if (!(error instanceof HostError && error.status === 404)) throw error;
      }
    },
  };
}
