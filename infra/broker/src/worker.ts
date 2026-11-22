import { type AddressRequest, type Broker, CloudflareError, makeBroker } from "./broker.ts";
import { makeCloudflareClient } from "./cloudflare.ts";
import { BrokerError, type BrokerErrorCode, ERROR_STATUS } from "./errors.ts";
import { makeD1Store } from "./store.ts";

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
}

const MAX_BODY_CHARS = 4096;

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
  const { pathname } = new URL(request.url);
  if (pathname === "/" && request.method === "GET") {
    return new Response(
      `Majordome address broker: gives a Majordome computer a public address under ${env.ZONE_NAME}. Report abuse to ${env.ABUSE_CONTACT}.\n`,
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
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof BrokerError) return errorResponse(error.code, error.message);
      console.error("Address request failed", error);
      const retryAfter = error instanceof CloudflareError ? error.retryAfter : null;
      return errorResponse(
        "upstream",
        "The address service could not reach Cloudflare. Try again in a few minutes.",
        retryAfter === null ? undefined : { "retry-after": retryAfter },
      );
    }
  },
  async scheduled(_controller, env) {
    console.log("Reaped addresses", await brokerFor(env).reap());
  },
} satisfies ExportedHandler<Env>;
