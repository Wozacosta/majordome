import type { AppleClient, PaidState, SubscriptionFacts } from "./billing.ts";
import { HostError } from "./hosting.ts";

/**
 * Apple's App Store Server API, asked how a subscription stands. Its answer arrives from Apple
 * over HTTPS, so the signed parts inside are read without checking their signatures again; a
 * purchase or a notice the phone or anyone else sends is never read for anything but the
 * transaction it names.
 */

const HOSTS = {
  Production: "https://api.storekit.apple.com",
  Sandbox: "https://api.storekit-sandbox.apple.com",
} as const;

// 1 active, 2 expired, 3 billing retry without grace, 4 billing grace period, 5 revoked.
const STATES: Readonly<Record<number, PaidState>> = {
  1: "active",
  2: "ended",
  3: "ended",
  4: "past_due",
  5: "ended",
};

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** The middle part of a signed value, read without checking who signed it. */
export function unverifiedPayload(signed: unknown): Record<string, unknown> {
  try {
    const part = typeof signed === "string" ? (signed.split(".")[1] ?? "") : "";
    const binary = atob(part.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
    );
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The transaction a notice from Apple is about; null when it names none. */
export function noticeTransaction(body: unknown): string | null {
  const notice = unverifiedPayload((body as { signedPayload?: unknown } | null)?.signedPayload);
  const data = notice.data as { signedTransactionInfo?: unknown } | undefined;
  const id = unverifiedPayload(data?.signedTransactionInfo).originalTransactionId;
  return typeof id === "string" && /^\d{1,32}$/u.test(id) ? id : null;
}

interface StatusResponse {
  readonly bundleId?: string;
  readonly data?: ReadonlyArray<{
    readonly lastTransactions?: ReadonlyArray<{
      readonly status?: number;
      readonly originalTransactionId?: string;
      readonly signedTransactionInfo?: string;
      readonly signedRenewalInfo?: string;
    }>;
  }>;
}

/** Apple's answer about a subscription, in this service's words; null when it is not ours. */
export function appleFacts(
  response: StatusResponse,
  expected: { readonly bundleId: string; readonly productId: string },
): SubscriptionFacts | null {
  if (response.bundleId !== expected.bundleId) return null;
  for (const group of response.data ?? []) {
    for (const last of group.lastTransactions ?? []) {
      const transaction = unverifiedPayload(last.signedTransactionInfo);
      const renewal = unverifiedPayload(last.signedRenewalInfo);
      if (transaction.productId !== expected.productId) continue;
      if (typeof last.originalTransactionId !== "string") continue;
      if (typeof transaction.appAccountToken !== "string") continue;
      const state = STATES[last.status ?? 0] ?? "ended";
      const grace = renewal.gracePeriodExpiresDate;
      const expires =
        state === "past_due" && typeof grace === "number" ? grace : transaction.expiresDate;
      return {
        source: "apple",
        appToken: transaction.appAccountToken.toLowerCase(),
        customerId: null,
        subscriptionId: last.originalTransactionId,
        state,
        periodEnd: typeof expires === "number" ? expires : null,
        cancels: renewal.autoRenewStatus === 0,
      };
    }
  }
  return null;
}

export function makeAppleClient(config: {
  /** The App Store Server API key: its `.p8` file's text, its id, and the team's issuer id. */
  readonly privateKey: string;
  readonly keyId: string;
  readonly issuerId: string;
  readonly bundleId: string;
  readonly productId: string;
  /** Purchases made with test accounts count too: for App Review and TestFlight. */
  readonly allowSandbox: boolean;
  readonly now: () => number;
}): AppleClient {
  const bearer = async () => {
    const pem = config.privateKey.replaceAll(/-----[^-]+-----|\s/gu, "");
    const key = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const issuedAt = Math.floor(config.now() / 1000);
    const unsigned = `${encodeJson({ alg: "ES256", kid: config.keyId, typ: "JWT" })}.${encodeJson({
      iss: config.issuerId,
      iat: issuedAt,
      exp: issuedAt + 300,
      aud: "appstoreconnect-v1",
      bid: config.bundleId,
    })}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  };

  return {
    subscription: async (transactionId) => {
      if (!/^\d{1,32}$/u.test(transactionId)) return null;
      const authorization = `Bearer ${await bearer()}`;
      // A transaction lives in one of Apple's two worlds and the other answers 404 for it. Until
      // the app is on the store, production refuses the key outright (401) instead: with test
      // purchases allowed, a refusal there still leaves the sandbox to ask.
      let refused: HostError | null = null;
      for (const host of config.allowSandbox
        ? [HOSTS.Production, HOSTS.Sandbox]
        : [HOSTS.Production]) {
        const response = await fetch(`${host}/inApps/v1/subscriptions/${transactionId}`, {
          headers: { authorization },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 404) continue;
        if (!response.ok) {
          refused ??= new HostError(
            response.status,
            `Apple answered ${response.status} for a subscription.`,
          );
          continue;
        }
        return appleFacts((await response.json()) as StatusResponse, config);
      }
      if (refused !== null) throw refused;
      return null;
    },
  };
}
