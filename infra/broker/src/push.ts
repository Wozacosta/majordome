import { BrokerError } from "./errors.ts";
import { verifyProof } from "./proof.ts";

/**
 * Notifications for the phone apps. A Majordome computer cannot hold Apple's or Google's sending
 * keys (the app is public, the keys are the publisher's), so it signs each notification with its
 * own key and this passes it on. Nothing about a notification is stored: not the device, not the
 * title, not the text. Only a count per computer and per network, for the limit.
 */

const HOUR_MS = 60 * 60 * 1000;
const TITLE_MAX = 120;
const BODY_MAX = 400;
const TTL_SECONDS = 24 * 60 * 60;
/** The Android channel the app makes when notifications are turned on. */
const ANDROID_CHANNEL = "majordome";

export type PushPlatform = "ios" | "android";
export type PushResult = "sent" | "gone";

export interface PushMessage {
  readonly platform: PushPlatform;
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /** Replaces an earlier notification with the same tag. */
  readonly tag: string;
  /** The path the app opens when the notification is tapped. */
  readonly deepLink: string;
  /** iPhone only: the app's bundle id, and which of Apple's two services knows the token. */
  readonly topic?: string;
  readonly environment?: "production" | "sandbox";
}

/** Apple or Google. `gone` means the token will never work again. */
export interface PushProvider {
  readonly send: (message: PushMessage) => Promise<PushResult>;
}

/** Apple or Google refused, for a reason that is not the device's. */
export class PushProviderError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    super(`The notification service answered ${status} (${reason}).`);
    this.status = status;
    this.reason = reason;
  }
}

export interface PushUsageStore {
  /** Adds one to the count for `key` in that hour and returns the new count. */
  readonly count: (key: string, hour: number) => Promise<number>;
}

export interface PushRequest {
  readonly publicKey: string;
  readonly proof: string;
  /** The notification as JSON text: the proof signs its SHA-256, so it cannot be changed on the way. */
  readonly message: string;
  readonly clientIp: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

const pemBytes = (pem: string) =>
  Uint8Array.from(atob(pem.replaceAll(/-----[^-]+-----|\s/gu, "")), (char) => char.charCodeAt(0));

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const invalid = (message: string) => new BrokerError("invalid_request", message);

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

/** The notification a computer sent, or an `invalid_request` saying what is wrong with it. */
function parsePushMessage(json: string): PushMessage {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null) throw new Error("not an object");
    parsed = value as Record<string, unknown>;
  } catch {
    throw invalid("message must be a JSON object.");
  }
  if (parsed.platform !== "ios" && parsed.platform !== "android") {
    throw invalid("platform must be ios or android.");
  }
  const platform: PushPlatform = parsed.platform;
  const token = text(parsed.token, 1024);
  if (
    token === null ||
    !(platform === "ios" ? /^[0-9a-fA-F]{64,200}$/u : /^[\w:-]{20,1024}$/u).test(token)
  ) {
    throw invalid("token is not a device token.");
  }
  const title = text(parsed.title, TITLE_MAX);
  const body = text(parsed.body, BODY_MAX);
  if (title === null || title.trim() === "" || body === null) {
    throw invalid(`title (up to ${TITLE_MAX} characters) and body (up to ${BODY_MAX}) are needed.`);
  }
  const tag = text(parsed.tag, 64);
  if (tag === null || !/^[\w:.-]+$/u.test(tag)) throw invalid("tag is not valid.");
  const deepLink = text(parsed.deepLink, 300);
  if (deepLink === null || !deepLink.startsWith("/") || deepLink.startsWith("//")) {
    throw invalid("deepLink must be a path in the app.");
  }
  const message = { platform, token, title, body, tag, deepLink };
  if (platform === "android") return message;
  const topic = text(parsed.topic, 200);
  const { environment } = parsed;
  if (topic === null || (environment !== "production" && environment !== "sandbox")) {
    throw invalid("An iPhone needs topic and environment.");
  }
  return { ...message, topic, environment };
}

export function makePush(deps: {
  readonly usage: PushUsageStore;
  /** Null while that side's credentials are not set. */
  readonly apns: PushProvider | null;
  readonly fcm: PushProvider | null;
  /** The iPhone app's bundle id; its `.dev` and `.preview` builds are allowed too. */
  readonly bundleId: string;
  readonly now: () => number;
  readonly config: { readonly maxPerIdentityPerHour: number; readonly maxPerIpPerHour: number };
}) {
  const available = { ios: deps.apns !== null, android: deps.fcm !== null };
  return {
    available,
    send: async (request: PushRequest): Promise<{ readonly result: PushResult }> => {
      const now = deps.now();
      const { identity, sha } = await verifyProof({
        publicKey: request.publicKey,
        proof: request.proof,
        action: "push",
        nowSeconds: Math.floor(now / 1000),
      });
      if (sha !== (await sha256Hex(request.message))) {
        throw new BrokerError("invalid_proof", "The proof was made for another notification.");
      }
      const message = parsePushMessage(request.message);
      const provider = message.platform === "ios" ? deps.apns : deps.fcm;
      if (provider === null) {
        throw new BrokerError("push_off", "Notifications for this kind of phone are not set up.");
      }
      if (
        message.topic !== undefined &&
        message.topic !== deps.bundleId &&
        !message.topic.startsWith(`${deps.bundleId}.`)
      ) {
        throw invalid("topic is not Majordome's app.");
      }
      const hour = Math.floor(now / HOUR_MS);
      // A key costs nothing to make, so the network is limited too.
      if (
        (await deps.usage.count(`id:${identity}`, hour)) > deps.config.maxPerIdentityPerHour ||
        (await deps.usage.count(`ip:${request.clientIp}`, hour)) > deps.config.maxPerIpPerHour
      ) {
        throw new BrokerError("rate_limited", "Too many notifications this hour.");
      }
      try {
        return { result: await provider.send(message) };
      } catch (error) {
        if (!(error instanceof PushProviderError)) throw error;
        // The status and Apple's or Google's reason only: never the device or the text.
        console.error("A notification was refused", error.status, error.reason);
        throw new BrokerError("upstream", "The phone's notification service refused it.");
      }
    },
  };
}

export type Push = ReturnType<typeof makePush>;

const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;
// Apple refuses a token older than an hour and one renewed more than every 20 minutes.
const APNS_TOKEN_MS = 40 * 60 * 1000;
const APNS_GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** Apple's push service, with a token key (`.p8`) of the team that publishes the app. */
export function makeApnsClient(config: {
  readonly privateKey: string;
  readonly keyId: string;
  readonly teamId: string;
  readonly now: () => number;
  readonly fetch?: Fetch;
}): PushProvider {
  const send: Fetch = config.fetch ?? ((input, init) => fetch(input, init));
  let cached: { readonly token: string; readonly at: number } | null = null;
  const bearer = async () => {
    const now = config.now();
    if (cached !== null && now - cached.at < APNS_TOKEN_MS) return cached.token;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(config.privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const unsigned = `${encodeJson({ alg: "ES256", kid: config.keyId })}.${encodeJson({
      iss: config.teamId,
      iat: Math.floor(now / 1000),
    })}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    );
    cached = { token: `${unsigned}.${base64Url(new Uint8Array(signature))}`, at: now };
    return cached.token;
  };

  return {
    send: async (message) => {
      const response = await send(
        `${APNS_HOSTS[message.environment ?? "production"]}/3/device/${message.token}`,
        {
          method: "POST",
          headers: {
            authorization: `bearer ${await bearer()}`,
            "apns-topic": message.topic ?? "",
            "apns-push-type": "alert",
            "apns-priority": "10",
            "apns-expiration": String(Math.floor(config.now() / 1000) + TTL_SECONDS),
            "apns-collapse-id": message.tag,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            aps: {
              alert: { title: message.title, body: message.body },
              sound: "default",
              "thread-id": message.tag,
            },
            // Where the app reads a notification's data from.
            body: { deepLink: message.deepLink },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.ok) return "sent";
      const reason = await response.json().then(
        (body) => String((body as { reason?: unknown } | null)?.reason ?? "unknown"),
        () => "unknown",
      );
      if (response.status === 410 || (response.status === 400 && APNS_GONE_REASONS.has(reason))) {
        return "gone";
      }
      throw new PushProviderError(response.status, reason);
    },
  };
}

interface ServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
}

/** The parts of a Firebase service account file this needs; null when the text is not one. */
export function readServiceAccount(json: string | undefined): ServiceAccount | null {
  try {
    const account = JSON.parse(json ?? "") as Partial<ServiceAccount> | null;
    return typeof account?.project_id === "string" &&
      typeof account.client_email === "string" &&
      typeof account.private_key === "string"
      ? {
          project_id: account.project_id,
          client_email: account.client_email,
          private_key: account.private_key,
        }
      : null;
  } catch {
    return null;
  }
}

const FCM_GONE_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

interface FcmError {
  readonly error?: {
    readonly status?: string;
    readonly details?: ReadonlyArray<{ readonly errorCode?: string }>;
  };
}

/** Firebase Cloud Messaging (HTTP v1), with the Firebase project's service account. */
export function makeFcmClient(config: {
  readonly serviceAccount: ServiceAccount;
  readonly now: () => number;
  readonly fetch?: Fetch;
}): PushProvider {
  const send: Fetch = config.fetch ?? ((input, init) => fetch(input, init));
  const { serviceAccount } = config;
  let cached: { readonly token: string; readonly until: number } | null = null;
  const accessToken = async () => {
    const now = config.now();
    if (cached !== null && now < cached.until) return cached.token;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(serviceAccount.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const issuedAt = Math.floor(now / 1000);
    const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
    })}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    );
    const response = await send("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!response.ok || typeof body?.access_token !== "string") {
      throw new PushProviderError(response.status, "no access token");
    }
    const lifetime = typeof body.expires_in === "number" ? body.expires_in : 3600;
    cached = { token: body.access_token, until: now + (lifetime - 300) * 1000 };
    return cached.token;
  };

  return {
    send: async (message) => {
      const response = await send(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${await accessToken()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: message.token,
              android: { priority: "HIGH", ttl: `${TTL_SECONDS}s` },
              // Data only, in the shape the app's notification library shows by itself: it
              // then decides in the app whether the chat is already on screen.
              data: {
                title: message.title,
                message: message.body,
                body: JSON.stringify({ deepLink: message.deepLink }),
                channelId: ANDROID_CHANNEL,
                tag: message.tag,
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.ok) return "sent";
      const error = ((await response.json().catch(() => null)) as FcmError | null)?.error;
      const codes = (error?.details ?? []).map((detail) => detail.errorCode ?? "");
      if (response.status === 404 || codes.some((code) => FCM_GONE_CODES.has(code))) return "gone";
      throw new PushProviderError(response.status, codes[0] || error?.status || "unknown");
    },
  };
}
