import { type HostClient, HostError } from "./hosting.ts";

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
  readonly image: string;
  readonly region: string;
  readonly memoryMb: number;
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

  return {
    urlFor,
    createServer: async ({ name, env }) => {
      const url = urlFor(name);
      const app = `/apps/${name}`;
      await call("POST", "/apps", { app_name: name, org_slug: config.orgSlug });
      // An app made through the API gets no address by itself.
      await call("POST", `${app}/ip_assignments`, { type: "shared_v4" });
      await call("POST", `${app}/ip_assignments`, { type: "v6" });
      // The volume first: a Machine made before it can land on another host and never attach.
      const volume = (await call("POST", `${app}/volumes`, {
        name: "data",
        region: config.region,
        size_gb: config.volumeGb,
      })) as { readonly id?: string } | undefined;
      if (typeof volume?.id !== "string") throw new HostError(502, "Fly returned no volume id.");
      await call("POST", `${app}/machines`, {
        name: "majordome",
        region: config.region,
        config: {
          image: config.image,
          env: { ...env, MAJORDOME_PUBLIC_URL: url },
          guest: { cpu_kind: "shared", cpus: 2, memory_mb: config.memoryMb },
          mounts: [{ volume: volume.id, path: "/data" }],
          restart: { policy: "always" },
          services: [
            {
              protocol: "tcp",
              internal_port: 3773,
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"] },
              ],
            },
          ],
        },
      });
      return { url };
    },
    updateServer: async (name) => {
      const machines = (await call("GET", `/apps/${name}/machines`)) as
        | ReadonlyArray<{ readonly id?: string; readonly config?: unknown }>
        | undefined;
      for (const machine of machines ?? []) {
        if (typeof machine.id !== "string" || machine.config === undefined) continue;
        // The same config: Fly looks the image's tag up again and restarts on what it finds.
        await call("POST", `/apps/${name}/machines/${machine.id}`, { config: machine.config });
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
