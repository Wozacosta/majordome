import { type AccountKey, accountEmail, makeAccountVerifier } from "./account.ts";
import { adminAccounts, makeInviteAdmin } from "./admin.ts";
import { makeAppleClient, noticeTransaction } from "./apple.ts";
import { type Billing, makeBilling } from "./billing.ts";
import {
  type AddressRequest,
  type Broker,
  clientBucket,
  CloudflareError,
  makeBroker,
} from "./broker.ts";
import { makeCloudflareClient } from "./cloudflare.ts";
import { BrokerError, type BrokerErrorCode, ERROR_STATUS } from "./errors.ts";
import { makeFlyHost } from "./fly.ts";
import {
  type HostClient,
  HostError,
  type Hosting,
  imageByDigest,
  makeHosting,
  releaseVersion,
  serverProgress,
  updateServers,
} from "./hosting.ts";
import {
  makeApnsClient,
  makeFcmClient,
  makePush,
  type Push,
  type PushProvider,
  readServiceAccount,
} from "./push.ts";
import { START_PAGE } from "./startPage.ts";
import {
  makeD1AccountStore,
  makeD1InviteAdminStore,
  makeD1InviteStore,
  makeD1PushUsageStore,
  makeD1Store,
  makeD1WaitlistStore,
} from "./store.ts";
import { makeStripeClient } from "./stripe.ts";
import { handleVoice } from "./voice.ts";
import { makeWaitlist } from "./waitlist.ts";

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
  /** The image's repository, without a tag: servers run the digest the latest release names. */
  readonly HOSTED_IMAGE?: string;
  readonly HOSTED_REGION?: string;
  readonly MAX_HOSTED_SERVERS?: string;
  /** Majordome's account service. With it, a new server can belong to a signed-in account. */
  readonly ACCOUNT_ISSUER?: string;
  /** The one other site allowed to call from a browser: where people sign in and leave an email. */
  readonly ACCOUNT_PAGE_ORIGIN?: string;
  /** The accounts that may make and take back invites, comma-separated. Nobody when not set. */
  readonly ADMIN_ACCOUNT_IDS?: string;
  /** Secret. Where a line of text is posted when the hourly pass fails; nothing is sent without it. */
  readonly ALERT_URL?: string;
  /** Paying on the website is offered only when these two secrets and the price are set. */
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_ID?: string;
  /** "1" once Stripe has approved the account for Managed Payments. */
  readonly STRIPE_MANAGED_PAYMENTS?: string;
  readonly TRIAL_DAYS?: string;
  readonly RETENTION_DAYS?: string;
  /** Paying in the iPhone app is offered only when this secret, the text of the `.p8`, is set. */
  readonly APPLE_IAP_KEY?: string;
  readonly APPLE_IAP_KEY_ID?: string;
  readonly APPLE_IAP_ISSUER_ID?: string;
  readonly APPLE_BUNDLE_ID?: string;
  readonly APPLE_PRODUCT_ID?: string;
  readonly APPLE_ALLOW_SANDBOX?: string;
  /** Notifications reach iPhones only when this secret, the text of the push key's `.p8`, is set. */
  readonly APNS_KEY?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_TEAM_ID?: string;
  /** Notifications reach Android phones only when this secret, the service account's JSON, is set. */
  readonly FCM_SERVICE_ACCOUNT?: string;
  readonly MAX_PUSH_PER_HOUR?: string;
  readonly MAX_PUSH_PER_IP_PER_HOUR?: string;
}

const MAX_BODY_CHARS = 4096;
// A payment notice carries the whole subscription or a signed transaction.
const MAX_NOTICE_CHARS = 262_144;

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

// Kept between requests while the Worker stays warm: each holds the token it signed or was given.
let pushProviders: {
  readonly secrets: string;
  readonly apns: PushProvider | null;
  readonly fcm: PushProvider | null;
} | null = null;

function pushFor(env: Env): Push {
  const secrets = [env.APNS_KEY, env.APNS_KEY_ID, env.APNS_TEAM_ID, env.FCM_SERVICE_ACCOUNT].join();
  if (pushProviders?.secrets !== secrets) {
    const serviceAccount = readServiceAccount(env.FCM_SERVICE_ACCOUNT);
    const now = () => Date.now();
    pushProviders = {
      secrets,
      apns:
        env.APNS_KEY === undefined ||
        env.APNS_KEY_ID === undefined ||
        env.APNS_TEAM_ID === undefined
          ? null
          : makeApnsClient({
              privateKey: env.APNS_KEY,
              keyId: env.APNS_KEY_ID,
              teamId: env.APNS_TEAM_ID,
              now,
            }),
      fcm: serviceAccount === null ? null : makeFcmClient({ serviceAccount, now }),
    };
  }
  return makePush({
    usage: makeD1PushUsageStore(env.DB),
    apns: pushProviders.apns,
    fcm: pushProviders.fcm,
    bundleId: env.APPLE_BUNDLE_ID ?? "io.github.wozacosta.majordome.ios",
    now: () => Date.now(),
    config: {
      maxPerIdentityPerHour: limit(env.MAX_PUSH_PER_HOUR, 120),
      maxPerIpPerHour: limit(env.MAX_PUSH_PER_IP_PER_HOUR, 600),
    },
  });
}

const HOSTED_NAME_PREFIX = "majordome-";
const WAITLIST_PATH = "/v1/waitlist";
const ADMIN_PATH = "/v1/admin/";

const hostFor = (env: Env): HostClient | null =>
  env.FLY_API_TOKEN === undefined || env.FLY_ORG_SLUG === undefined
    ? null
    : makeFlyHost({
        apiToken: env.FLY_API_TOKEN,
        orgSlug: env.FLY_ORG_SLUG,
        region: env.HOSTED_REGION ?? "ams",
        // A server rests near 600 MB and reached 934 MB with a chat and the browser open
        // (measured 2026-11-26), so swap covers the rest.
        memoryMb: 1024,
        swapMb: 1024,
        volumeGb: 3,
      });

const hostingFor = (env: Env, host: HostClient): Hosting =>
  makeHosting({
    invites: makeD1InviteStore(env.DB),
    host,
    image: imageFor(env),
    // Paid servers take places under the same cap.
    otherServers: () => makeD1AccountStore(env.DB).runningServers(Date.now()),
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    config: { namePrefix: HOSTED_NAME_PREFIX, maxServers: limit(env.MAX_HOSTED_SERVERS, 5) },
  });

const imageFor = (env: Env) => async () => {
  const version = await latestRelease();
  const image = version === null ? null : await releasedImage(env, version);
  if (image === null) throw new HostError(503, "The latest release names no image yet.");
  return image;
};

/** Paid servers, by either way of paying; null while the account service is not named. */
function billingFor(env: Env, host: HostClient): Billing | null {
  const pageOrigin = env.ACCOUNT_PAGE_ORIGIN;
  if (env.ACCOUNT_ISSUER === undefined || pageOrigin === undefined) return null;
  const stripe =
    env.STRIPE_SECRET_KEY === undefined || env.STRIPE_PRICE_ID === undefined
      ? null
      : makeStripeClient({
          secretKey: env.STRIPE_SECRET_KEY,
          priceId: env.STRIPE_PRICE_ID,
          managedPayments: env.STRIPE_MANAGED_PAYMENTS === "1",
          startPage: `${pageOrigin}/start`,
          managePage: `${pageOrigin}/server`,
        });
  const apple =
    env.APPLE_IAP_KEY === undefined ||
    env.APPLE_IAP_KEY_ID === undefined ||
    env.APPLE_IAP_ISSUER_ID === undefined ||
    env.APPLE_BUNDLE_ID === undefined ||
    env.APPLE_PRODUCT_ID === undefined
      ? null
      : makeAppleClient({
          privateKey: env.APPLE_IAP_KEY,
          keyId: env.APPLE_IAP_KEY_ID,
          issuerId: env.APPLE_IAP_ISSUER_ID,
          bundleId: env.APPLE_BUNDLE_ID,
          productId: env.APPLE_PRODUCT_ID,
          allowSandbox: env.APPLE_ALLOW_SANDBOX === "1",
          now: () => Date.now(),
        });
  if (stripe === null && apple === null) return null;
  return makeBilling({
    accounts: makeD1AccountStore(env.DB),
    host,
    stripe,
    apple,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
    image: imageFor(env),
    otherServers: makeD1InviteStore(env.DB).live,
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    randomUUID: () => crypto.randomUUID(),
    config: {
      namePrefix: HOSTED_NAME_PREFIX,
      maxServers: limit(env.MAX_HOSTED_SERVERS, 5),
      trialDays: limit(env.TRIAL_DAYS, 7),
      retentionDays: limit(env.RETENTION_DAYS, 30),
    },
  });
}

/** Every server this service made and has not deleted, from an invite or paid for. */
const liveNamesFor = (env: Env) => async () => [
  ...(await makeD1InviteStore(env.DB).liveNames()),
  ...(await makeD1AccountStore(env.DB).serverNames()),
];

const RELEASES_URL = "https://github.com/Wozacosta/majordome/releases";
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
  const response = await fetch(`${RELEASES_URL}/latest`, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  return releaseVersion(response.headers.get("location"));
}

/**
 * That release's image by its digest, from the `image-digest.txt` the image's build attaches to
 * the release; null until it is there.
 */
async function releasedImage(env: Env, version: string): Promise<string | null> {
  const response = await fetch(`${RELEASES_URL}/download/v${version}/image-digest.txt`, {
    signal: AbortSignal.timeout(8000),
  });
  return response.ok
    ? imageByDigest(env.HOSTED_IMAGE ?? "ghcr.io/wozacosta/majordome", await response.text())
    : null;
}

async function updateHosted(env: Env) {
  const host = hostFor(env);
  if (host === null) return null;
  const latestVersion = await latestRelease();
  if (latestVersion === null) return { error: "no latest release found" };
  const image = await releasedImage(env, latestVersion);
  if (image === null) return { latestVersion, error: "the release names no image yet" };
  return {
    latestVersion,
    image,
    ...(await updateServers({
      names: await liveNamesFor(env)(),
      host,
      latestVersion,
      image,
      versionOf: (name) => serverVersion(host, name),
    })),
  };
}

const answers = (host: HostClient, name: string) =>
  fetch(`${host.urlFor(name)}/.well-known/t3/environment`, {
    signal: AbortSignal.timeout(8000),
  }).then(
    (response) => response.ok,
    () => false,
  );

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

/** The strings of a small JSON body; anything else in it is dropped. */
async function readFields(request: Request): Promise<Readonly<Record<string, string>>> {
  const text = await request.text();
  try {
    const body: unknown = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
    if (typeof body === "object" && body !== null) {
      return Object.fromEntries(
        Object.entries(body).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    // Answered below, like any other body that is not what was asked for.
  }
  throw new BrokerError("invalid_request", "Send a JSON body.");
}

async function readNotice(request: Request): Promise<string> {
  const text = await request.text();
  if (text.length > MAX_NOTICE_CHARS) throw new BrokerError("invalid_request", "Too long.");
  return text;
}

/** The signed-in account a request is from. Every paid route needs one. */
async function accountOf(env: Env, fields: Readonly<Record<string, string>>): Promise<string> {
  if (fields.accountToken === undefined || env.ACCOUNT_ISSUER === undefined) {
    throw new BrokerError("invalid_account", "Sign in first.");
  }
  return accountVerifierFor(env.ACCOUNT_ISSUER)(fields.accountToken);
}

async function readWaitlist(
  request: Request,
): Promise<{ readonly email: unknown; readonly platforms: unknown }> {
  const text = await request.text();
  try {
    const body: unknown = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
    if (typeof body === "object" && body !== null) {
      return body as { readonly email: unknown; readonly platforms: unknown };
    }
  } catch {
    // Answered below, like any other body that is not what was asked for.
  }
  throw new BrokerError("invalid_request", "Send a JSON body with email and platforms.");
}

const clientOf = (request: Request) =>
  clientBucket(request.headers.get("cf-connecting-ip") ?? "unknown");

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
  return { publicKey, proof, clientIp: clientOf(request) };
}

async function handle(request: Request, env: Env, later: Later): Promise<Response> {
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
  if (pathname === WAITLIST_PATH && request.method === "POST") {
    const { email, platforms } = await readWaitlist(request);
    await makeWaitlist({
      store: makeD1WaitlistStore(env.DB),
      now: () => Date.now(),
      maxPerIpPerDay: 6,
    }).join({ email, platforms, clientIp: request.headers.get("cf-connecting-ip") ?? "unknown" });
    return new Response(null, { status: 204 });
  }
  if (pathname === "/v1/push" && request.method === "GET") {
    return Response.json(pushFor(env).available, { headers: { "cache-control": "no-store" } });
  }
  if (pathname === "/v1/push" && request.method === "POST") {
    const { publicKey, proof, message } = await readFields(request);
    if (publicKey === undefined || proof === undefined || message === undefined) {
      throw new BrokerError("invalid_request", "Send publicKey, proof and message.");
    }
    return Response.json(
      await pushFor(env).send({ publicKey, proof, message, clientIp: clientOf(request) }),
    );
  }
  const host = hostFor(env);
  if (pathname.startsWith(ADMIN_PATH) && request.method === "POST") {
    const answer = await handleAdmin(pathname.slice(ADMIN_PATH.length), request, env, host);
    if (answer !== null) return answer;
  }
  if (host !== null && pathname === "/start" && request.method === "GET") {
    return new Response(START_PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (host !== null && pathname === "/v1/hosted/ready" && request.method === "GET") {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return Response.json(
      await serverProgress({
        name,
        namePrefix: HOSTED_NAME_PREFIX,
        liveNames: liveNamesFor(env),
        host,
        answers: (server) => answers(host, server),
      }),
      { headers: { "cache-control": "no-store" } },
    );
  }
  const billing = host === null ? null : billingFor(env, host);
  if (billing !== null && pathname.startsWith("/v1/billing/") && request.method === "POST") {
    const answer = await handleBilling(pathname.slice("/v1/billing/".length), request, env, {
      billing,
      later,
    });
    if (answer !== null) return answer;
  }
  if (host !== null && pathname === "/v1/hosted" && request.method === "POST") {
    const fields = await readFields(request);
    const invite = fields.invite?.trim() ?? "";
    if (invite === "" && billing !== null) {
      return Response.json(
        await billing.server({
          accountId: await accountOf(env, fields),
          checkoutSession: fields.checkoutSession,
        }),
      );
    }
    // The account is checked before the invite is spent, so a bad sign-in costs nothing.
    const ownerAccountId =
      fields.accountToken === undefined || env.ACCOUNT_ISSUER === undefined
        ? undefined
        : await accountOf(env, fields);
    return Response.json(
      await hostingFor(env, host).create({
        invite,
        clientIp: clientOf(request),
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
  async fetch(request, env, context) {
    const voice = await handleVoice(request);
    if (voice !== null) return voice;
    const { pathname } = new URL(request.url);
    const fromSite =
      pathname.startsWith("/v1/hosted") ||
      pathname.startsWith("/v1/billing/") ||
      pathname.startsWith(ADMIN_PATH) ||
      pathname === WAITLIST_PATH;
    const cors = fromSite
      ? accountPageCors(request.headers.get("origin"), env.ACCOUNT_PAGE_ORIGIN)
      : {};
    if (fromSite && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    const answer = await answerFor(request, env, (work) =>
      context.waitUntil(work.catch((error) => console.error("Could not settle an account", error))),
    );
    for (const [name, value] of Object.entries(cors)) answer.headers.set(name, value);
    return answer;
  },
  async scheduled(controller, env) {
    // Each run has its own budget of requests, so the two jobs never share one.
    if (controller.cron === UPDATE_CRON) {
      console.log("Updated hosted servers", await updateHosted(env));
      return;
    }
    // One job failing must not cost the other its hour.
    const problems: Array<string> = [];
    try {
      console.log("Reaped addresses", await brokerFor(env).reap());
    } catch (error) {
      console.error("Could not reap addresses", error);
      problems.push("idle addresses were not reclaimed");
    }
    await makeD1PushUsageStore(env.DB)
      .forget(Math.floor(Date.now() / 3_600_000) - 24)
      .catch((error) => console.error("Could not forget old notification counts", error));
    try {
      const host = hostFor(env);
      const report = host === null ? null : await billingFor(env, host)?.sweep();
      if (report != null) console.log("Settled paid servers", report);
      const failed = report?.failed.length ?? 0;
      if (failed > 0) problems.push(`${failed} paid server(s) could not be brought in line`);
    } catch (error) {
      console.error("Could not settle paid servers", error);
      problems.push("the pass over paid servers failed");
    }
    if (problems.length > 0) await alertOwner(env, `Majordome broker: ${problems.join("; ")}.`);
  },
} satisfies ExportedHandler<Env>;

/** Tells the owner something needs a look. No account is named: the address is an outside service. */
async function alertOwner(env: Env, message: string) {
  if (env.ALERT_URL === undefined) return;
  await fetch(env.ALERT_URL, { method: "POST", body: `${message} See the Worker's logs.` }).catch(
    (error) => console.error("Could not send an alert", error),
  );
}

/** Work that goes on after the answer is sent. */
type Later = (work: Promise<unknown>) => void;

async function handleBilling(
  route: string,
  request: Request,
  env: Env,
  { billing, later }: { readonly billing: Billing; readonly later: Later },
): Promise<Response | null> {
  // The two providers' notices come first: they carry no account and their own proof.
  if (route === "stripe") {
    const accountId = await billing.stripeEvent({
      body: await readNotice(request),
      signature: request.headers.get("stripe-signature"),
    });
    // Making a server takes longer than Stripe waits; the hourly pass finishes it if this fails.
    if (accountId !== null) later(billing.settle(accountId));
    return new Response(null, { status: 204 });
  }
  // The phone app asks this route, with no account, whether it may sell: 404 means it may not.
  if (route.startsWith("apple") && !billing.takesApple) return null;
  if (route === "apple/notice") {
    let transactionId: string | null = null;
    try {
      transactionId = noticeTransaction(JSON.parse(await readNotice(request)));
    } catch {
      // Not a notice: answered as one that names nothing.
    }
    const accountId = transactionId === null ? undefined : await billing.appleNotice(transactionId);
    if (accountId !== undefined) later(billing.settle(accountId));
    return new Response(null, { status: 204 });
  }
  const fields = await readFields(request);
  const accountId = await accountOf(env, fields);
  switch (route) {
    case "status":
      return Response.json(await billing.status(accountId), {
        headers: { "cache-control": "no-store" },
      });
    case "checkout":
      return Response.json(
        await billing.checkout({
          accountId,
          email: accountEmail(fields.accountToken ?? ""),
          startedOn: fields.startedOn === "phone" ? "phone" : "computer",
        }),
      );
    case "portal":
      return Response.json(await billing.portal(accountId));
    case "apple":
      await billing.applePurchase({ accountId, transactionId: fields.transactionId ?? "" });
      return new Response(null, { status: 204 });
    case "withdraw":
      await billing.withdraw(accountId);
      return new Response(null, { status: 204 });
    case "wake":
      await billing.wake(accountId);
      return new Response(null, { status: 204 });
    case "delete-account":
      await billing.deleteAccount(accountId);
      return new Response(null, { status: 204 });
    default:
      return null;
  }
}

/** The owner's page. Null, so a 404, while no account is named as an admin. */
async function handleAdmin(
  route: string,
  request: Request,
  env: Env,
  host: HostClient | null,
): Promise<Response | null> {
  const admins = adminAccounts(env.ADMIN_ACCOUNT_IDS);
  if (admins.size === 0 || env.ACCOUNT_ISSUER === undefined) return null;
  const fields = await readFields(request);
  if (!admins.has(await accountOf(env, fields))) {
    throw new BrokerError("not_admin", "This account cannot manage invites.");
  }
  const admin = makeInviteAdmin({
    store: makeD1InviteAdminStore(env.DB),
    urlFor: host?.urlFor ?? null,
    servers: async () => (await liveNamesFor(env)()).length,
    maxServers: limit(env.MAX_HOSTED_SERVERS, 5),
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  });
  const fresh = { headers: { "cache-control": "no-store" } };
  switch (route) {
    case "invites":
      return Response.json(await admin.list(), fresh);
    case "invites/create":
      return Response.json(await admin.create(fields.note), fresh);
    case "invites/revoke":
      await admin.revoke(fields.code);
      return new Response(null, { status: 204 });
    default:
      return null;
  }
}

async function answerFor(request: Request, env: Env, later: Later): Promise<Response> {
  try {
    return await handle(request, env, later);
  } catch (error) {
    if (error instanceof BrokerError) return errorResponse(error.code, error.message);
    console.error("Address request failed", error);
    if (error instanceof HostError) {
      return errorResponse(
        "upstream",
        new URL(request.url).pathname.startsWith("/v1/billing/")
          ? "Majordome could not reach the payment service just now. Try again in a few minutes."
          : "Majordome could not make your server just now. Your invite is still good: try again in a few minutes.",
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
