import type { PaidState, StripeClient } from "./billing.ts";
import { HostError } from "./hosting.ts";

// Subscriptions carry their period on their items from 2025-03-31 on; both places are read.
const API_VERSION = "2026-11-18.endive";
const SIGNATURE_TOLERANCE_SECONDS = 300;

const STATES: Readonly<Record<string, PaidState>> = {
  trialing: "active",
  active: "active",
  past_due: "past_due",
  canceled: "ended",
  unpaid: "ended",
  paused: "ended",
  incomplete_expired: "ended",
};

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Whether Stripe signed that body, recently: `t=<seconds>,v1=<hex>` where the hex is the
 * HMAC-SHA256 of `<seconds>.<body>`. Entries it does not know are skipped.
 */
export async function verifyStripeSignature(input: {
  readonly body: string;
  readonly header: string | null;
  readonly secret: string;
  readonly nowSeconds: number;
}): Promise<boolean> {
  const entries = (input.header ?? "").split(",").map((entry) => entry.trim().split("="));
  const timestamp = entries.find(([name]) => name === "t")?.[1] ?? "";
  const signatures = entries.flatMap(([name, value]) => (name === "v1" && value ? [value] : []));
  if (!/^\d+$/u.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(input.nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${input.body}`)),
  );
  // Compared in full whatever the first difference, so the time taken says nothing.
  return signatures.some((signature) => {
    let difference = signature.length ^ expected.length;
    for (let index = 0; index < expected.length; index++) {
      difference |= (signature.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
    }
    return difference === 0;
  });
}

interface StripeSubscription {
  readonly id: string;
  readonly status: string;
  readonly customer: string | null;
  readonly cancel_at_period_end?: boolean;
  readonly cancel_at?: number | null;
  readonly current_period_end?: number;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly items?: { readonly data?: ReadonlyArray<{ readonly current_period_end?: number }> };
}

/** A subscription as Stripe returns it, in this service's words. */
export function subscriptionFacts(subscription: StripeSubscription) {
  const periodEnd =
    subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
  return {
    source: "web" as const,
    accountId: subscription.metadata?.account,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    state: STATES[subscription.status] ?? "none",
    periodEnd: periodEnd === undefined ? null : periodEnd * 1000,
    cancels:
      subscription.cancel_at_period_end === true || typeof subscription.cancel_at === "number",
    startedOn: subscription.metadata?.started_on ?? null,
  };
}

export function makeStripeClient(config: {
  readonly secretKey: string;
  readonly priceId: string;
  /** Stripe sells in its own name and handles the tax. The account must be approved for it. */
  readonly managedPayments: boolean;
  /** The page a customer comes back to; the checkout's id is added to it. */
  readonly startPage: string;
  readonly managePage: string;
}): StripeClient {
  const call = async (method: string, path: string, form?: Readonly<Record<string, string>>) => {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "stripe-version": API_VERSION,
        ...(form === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
      },
      ...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      readonly error?: { readonly message?: string; readonly code?: string };
    };
    if (!response.ok) {
      throw new HostError(
        response.status,
        `Stripe ${method} ${path.split("?")[0]} failed (${response.status}): ${body.error?.code ?? ""} ${body.error?.message ?? ""}`,
      );
    }
    return body;
  };

  // The price changes a few times a year at most; it is asked for once per warm Worker.
  let offer: {
    readonly amount: number;
    readonly currency: string;
    readonly interval: string;
  } | null = null;

  return {
    offer: async () => {
      if (offer === null) {
        const price = (await call("GET", `/prices/${encodeURIComponent(config.priceId)}`)) as {
          readonly unit_amount?: number;
          readonly currency?: string;
          readonly recurring?: { readonly interval?: string };
        };
        if (typeof price.unit_amount !== "number" || typeof price.currency !== "string") {
          throw new HostError(502, "Stripe returned no price.");
        }
        offer = {
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval ?? "month",
        };
      }
      return offer;
    },
    createCheckout: async ({ accountId, email, customerId, trialDays, startedOn }) => {
      const session = await call("POST", "/checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": config.priceId,
        "line_items[0][quantity]": "1",
        client_reference_id: accountId,
        "subscription_data[metadata][account]": accountId,
        "subscription_data[metadata][started_on]": startedOn,
        payment_method_collection: "always",
        success_url: `${config.startPage}?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: config.startPage,
        ...(customerId !== null
          ? { customer: customerId }
          : email !== null
            ? { customer_email: email }
            : {}),
        ...(trialDays > 0
          ? {
              "subscription_data[trial_period_days]": String(trialDays),
              "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
            }
          : {}),
        // As the seller, Stripe sets its own fraud rules; otherwise the card's owner must confirm.
        ...(config.managedPayments
          ? { "managed_payments[enabled]": "true" }
          : {
              // Said outright: an account approved for it has it switched on by default.
              "managed_payments[enabled]": "false",
              "payment_method_options[card][request_three_d_secure]": "any",
            }),
      });
      if (typeof session.url !== "string") throw new HostError(502, "Stripe returned no page.");
      return { url: session.url };
    },
    checkoutSubscription: async (sessionId) => {
      const session = await call("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
      return typeof session.subscription === "string" ? session.subscription : null;
    },
    subscription: async (subscriptionId) =>
      subscriptionFacts(
        (await call(
          "GET",
          `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        )) as unknown as StripeSubscription,
      ),
    cancel: async (subscriptionId) => {
      try {
        await call("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
      } catch (error) {
        // Already ended, or gone.
        if (!(error instanceof HostError && (error.status === 404 || error.status === 400))) {
          throw error;
        }
      }
    },
    portal: async (customerId) => {
      const session = await call("POST", "/billing_portal/sessions", {
        customer: customerId,
        return_url: config.managePage,
      });
      if (typeof session.url !== "string") throw new HostError(502, "Stripe returned no page.");
      return { url: session.url };
    },
    chargeCustomer: async (chargeId) => {
      const charge = await call("GET", `/charges/${encodeURIComponent(chargeId)}`);
      return typeof charge.customer === "string" ? charge.customer : null;
    },
    refundSince: async ({ customerId, since }) => {
      const charges = (await call(
        "GET",
        `/charges?customer=${encodeURIComponent(customerId)}&created[gte]=${Math.floor(since / 1000)}&limit=100`,
      )) as {
        readonly data?: ReadonlyArray<{
          readonly id: string;
          readonly paid?: boolean;
          readonly refunded?: boolean;
        }>;
      };
      for (const charge of charges.data ?? []) {
        if (charge.paid !== true || charge.refunded === true) continue;
        // With no amount, Stripe gives back whatever of the payment is left.
        await call("POST", "/refunds", { charge: charge.id, reason: "requested_by_customer" });
      }
    },
  };
}
