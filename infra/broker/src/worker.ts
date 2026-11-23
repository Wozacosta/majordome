import { type AccountKey, makeAccountVerifier } from "./account.ts";
import { type AddressRequest, type Broker, CloudflareError, makeBroker } from "./broker.ts";
import { makeCloudflareClient } from "./cloudflare.ts";
import { BrokerError, type BrokerErrorCode, ERROR_STATUS } from "./errors.ts";
import { makeFlyHost } from "./fly.ts";
import {
  type HostClient,
  HostError,
  type Hosting,
  isServerName,
  makeHosting,
  releaseVersion,
  updateServers,
} from "./hosting.ts";
import { START_PAGE } from "./startPage.ts";
import { makeD1InviteStore, makeD1Store } from "./store.ts";

interface Env {
  readonly DB: D1Database;
  readonly CLOUDFLARE_API_TOKEN: string;
  readonly CLOUDFLARE_ACCOUNT_ID: string;
  readonly CLOUDFLARE_ZONE_ID: string;
  readonly ZONE_NAME: string;
  readonly ABUSE_CONTACT: string;
  readonly MAX_NEW_PER_IP_PER_DAY?: string;
  readonly MAX_NEW_PER_DAY?: string;
  readonly MAX_LIVE_ADDRESSES?: string;
  /** Hosted servers are offered only when this secret is set. */
  readonly FLY_API_TOKEN?: string;
  readonly FLY_ORG_SLUG?: string;
  readonly HOSTED_IMAGE?: string;
  readonly HOSTED_REGION?: string;
  readonly MAX_HOSTED_SERVERS?: string;
  /** Majordome's account service. With it, a new server can belong to a signed-in account. */
  readonly ACCOUNT_ISSUER?: string;
  /** The one other site allowed to ask for a hosted server: where people sign in. */
  readonly ACCOUNT_PAGE_ORIGIN?: string;
}

const MAX_BODY_CHARS = 4096;

/**
 * Names Majordome's iPhone app (released, preview and development builds) as the one that opens
 * a server's pairing address, for every address under the zone: the app trusts `*.<zone>`
 * (`apps/mobile/majordome/identity.ts`) and iPhones read this file from the zone's root.
 */
export const APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: ["", ".preview", ".dev"].map(
          (suffix) => `5RDKJ8PDGZ.io.github.wozacosta.majordome.ios${suffix}`,
        ),
        components: [{ "/": "/pair" }],
      },
    ],
  },
};

const limit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const brokerFor = (env: Env): Broker =>
  makeBroker({
    store: makeD1Store(env.DB),
    cloudflare: makeCloudflareClient({
      apiToken: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      zoneId: env.CLOUDFLARE_ZONE_ID,
    }),
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    config: {
      zoneName: env.ZONE_NAME,
      maxNewPerIpPerDay: limit(env.MAX_NEW_PER_IP_PER_DAY, 3),
      maxNewPerDay: limit(env.MAX_NEW_PER_DAY, 40),
      maxLive: limit(env.MAX_LIVE_ADDRESSES, 180),
    },
  });

const HOSTED_NAME_PREFIX = "majordome-";

const hostFor = (env: Env): HostClient | null =>
  env.FLY_API_TOKEN === undefined || env.FLY_ORG_SLUG === undefined
    ? null
    : makeFlyHost({
        apiToken: env.FLY_API_TOKEN,
        orgSlug: env.FLY_ORG_SLUG,
        image: env.HOSTED_IMAGE ?? "ghcr.io/wozacosta/majordome:latest",
        region: env.HOSTED_REGION ?? "cdg",
        memoryMb: 2048,
        volumeGb: 3,
      });

const hostingFor = (env: Env, host: HostClient): Hosting =>
  makeHosting({
    invites: makeD1InviteStore(env.DB),
    host,
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    config: { namePrefix: HOSTED_NAME_PREFIX, maxServers: limit(env.MAX_HOSTED_SERVERS, 5) },
  });

const RELEASES_LATEST_URL = "https://github.com/Wozacosta/majordome/releases/latest";
/** Must match the second entry of `triggers.crons`. */
const UPDATE_CRON = "43 3 * * *";

/** The version a hosted server reports, or null while it does not answer. */
async function serverVersion(host: HostClient, name: string): Promise<string | null> {
  try {
    const response = await fetch(`${host.urlFor(name)}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = response.ok ? ((await response.json()) as { serverVersion?: unknown }) : {};
    return typeof body.serverVersion === "string" ? body.serverVersion : null;
  } catch {
    return null;
  }
}

/** The newest release, read from where its page redirects: no API, so no API limit. */
async function latestRelease(): Promise<string | null> {
  const response = await fetch(RELEASES_LATEST_URL, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  return releaseVersion(response.headers.get("location"));
}

async function updateHosted(env: Env) {
  const host = hostFor(env);
  if (host === null) return null;
  const latestVersion = await latestRelease();
  if (latestVersion === null) return { error: "no latest release found" };
  return {
    latestVersion,
    ...(await updateServers({
      names: await makeD1InviteStore(env.DB).liveNames(),
      host,
      latestVersion,
      versionOf: (name) => serverVersion(host, name),
    })),
  };
}

/**
 * How far a new server has come: switched on, then answering. The page cannot ask the server
 * directly from another origin, and shows each step as it is reached.
 */
async function serverProgress(
  host: HostClient,
  name: string,
): Promise<{ readonly switchedOn: boolean; readonly ready: boolean }> {
  if (!isServerName(HOSTED_NAME_PREFIX, name)) return { switchedOn: false, ready: false };
  const ready = await fetch(`${host.urlFor(name)}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(8000),
  }).then(
    (response) => response.ok,
    () => false,
  );
  if (ready) return { switchedOn: true, ready };
  return { switchedOn: await host.isSwitchedOn(name).catch(() => false), ready };
}

// Kept between requests while the Worker stays warm, so the keys are not fetched for each one.
let accountVerifier: {
  readonly issuer: string;
  readonly verify: (token: string) => Promise<string>;
} | null = null;

function accountVerifierFor(issuer: string) {
  if (accountVerifier?.issuer !== issuer) {
    accountVerifier = {
      issuer,
      verify: makeAccountVerifier({
        issuer,
        now: () => Date.now(),
        fetchKeys: async () => {
          const response = await fetch(`${issuer}/.well-known/jwks.json`, {
            signal: AbortSignal.timeout(8000),
          });
          const body = (await response.json()) as { keys?: ReadonlyArray<AccountKey> };
          if (!response.ok || !Array.isArray(body.keys)) throw new Error("no account keys");
          return body.keys;
        },
      }),
    };
  }
  return accountVerifier.verify;
}

/** The headers that let the sign-in site call the hosted routes from a browser; none otherwise. */
export function accountPageCors(
  requestOrigin: string | null,
  allowedOrigin: string | undefined,
): Record<string, string> {
  return allowedOrigin !== undefined && requestOrigin === allowedOrigin
    ? {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "origin",
      }
    : {};
}

async function readInvite(
  request: Request,
): Promise<{ readonly invite: string; readonly accountToken: string | null }> {
  const text = await request.text();
  let body: unknown;
  try {
    body = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const { invite, accountToken } = (body ?? {}) as { invite?: unknown; accountToken?: unknown };
  if (typeof invite !== "string") {
    throw new BrokerError("invalid_request", "Send a JSON body with invite.");
  }
  return { invite, accountToken: typeof accountToken === "string" ? accountToken : null };
}

const errorResponse = (code: BrokerErrorCode, message: string, headers?: HeadersInit) =>
  Response.json(
    { error: code, message },
    { status: ERROR_STATUS[code], ...(headers && { headers }) },
  );

async function readAddressRequest(request: Request): Promise<AddressRequest> {
  const text = await request.text();
  let body: unknown;
  try {
    body = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const { publicKey, proof } = (body ?? {}) as { publicKey?: unknown; proof?: unknown };
  if (typeof publicKey !== "string" || typeof proof !== "string") {
    throw new BrokerError("invalid_request", "Send a JSON body with publicKey and proof.");
  }
  return { publicKey, proof, clientIp: request.headers.get("cf-connecting-ip") ?? "unknown" };
}

async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname, hostname } = new URL(request.url);
  // The zone's root only says which phone app its addresses open in; iPhones read it from there.
  if (hostname === env.ZONE_NAME) {
    return pathname === "/.well-known/apple-app-site-association" && request.method === "GET"
      ? Response.json(APP_SITE_ASSOCIATION, { headers: { "cache-control": "max-age=3600" } })
      : new Response("Nothing is served here.\n", { status: 404 });
  }
  if (pathname === "/" && request.method === "GET") {
    return new Response(
      `Majordome address broker: gives a Majordome computer a public address under ${env.ZONE_NAME}. Report abuse to ${env.ABUSE_CONTACT}.\n`,
    );
  }
  const host = hostFor(env);
  if (host !== null && pathname === "/start" && request.method === "GET") {
    return new Response(START_PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (host !== null && pathname === "/v1/hosted/ready" && request.method === "GET") {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return Response.json(await serverProgress(host, name), {
      headers: { "cache-control": "no-store" },
    });
  }
  if (host !== null && pathname === "/v1/hosted" && request.method === "POST") {
    const { invite, accountToken } = await readInvite(request);
    // The account is checked before the invite is spent, so a bad sign-in costs nothing.
    const ownerAccountId =
      accountToken === null || env.ACCOUNT_ISSUER === undefined
        ? undefined
        : await accountVerifierFor(env.ACCOUNT_ISSUER)(accountToken);
    return Response.json(
      await hostingFor(env, host).create({
        invite,
        clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
        ...(ownerAccountId === undefined ? {} : { ownerAccountId }),
      }),
    );
  }
  if (pathname !== "/v1/address" || (request.method !== "POST" && request.method !== "DELETE")) {
    return Response.json(
      { error: "invalid_request", message: "Nothing is served here." },
      { status: 404 },
    );
  }
  const broker = brokerFor(env);
  const addressRequest = await readAddressRequest(request);
  if (request.method === "POST") return Response.json(await broker.claim(addressRequest));
  await broker.release(addressRequest);
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env) {
    const hosted = new URL(request.url).pathname.startsWith("/v1/hosted");
    const cors = hosted
      ? accountPageCors(request.headers.get("origin"), env.ACCOUNT_PAGE_ORIGIN)
      : {};
    if (hosted && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    const answer = await answerFor(request, env);
    for (const [name, value] of Object.entries(cors)) answer.headers.set(name, value);
    return answer;
  },
  async scheduled(controller, env) {
    // Each run has its own budget of requests, so the two jobs never share one.
    if (controller.cron === UPDATE_CRON) {
      console.log("Updated hosted servers", await updateHosted(env));
      return;
    }
    console.log("Reaped addresses", await brokerFor(env).reap());
  },
} satisfies ExportedHandler<Env>;

async function answerFor(request: Request, env: Env): Promise<Response> {
  try {
    return await handle(request, env);
  } catch (error) {
    if (error instanceof BrokerError) return errorResponse(error.code, error.message);
    console.error("Address request failed", error);
    if (error instanceof HostError) {
      return errorResponse(
        "upstream",
        "Majordome could not make your server just now. Your invite is still good: try again in a few minutes.",
      );
    }
    const retryAfter = error instanceof CloudflareError ? error.retryAfter : null;
    return errorResponse(
      "upstream",
      "The address service could not reach Cloudflare. Try again in a few minutes.",
      retryAfter === null ? undefined : { "retry-after": retryAfter },
    );
  }
}
