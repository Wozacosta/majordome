import { MAJORDOME_ACCOUNT, MAJORDOME_SERVER } from "./connectWording";
import {
  askBroker,
  NO_ANSWER_ERROR,
  signupErrorMessage,
  type Fetch,
  type SignupNote,
} from "./hostedSignup.logic";

const DEFAULT_PRODUCT_ID = "io.github.wozacosta.majordome.server.monthly";

/** The one subscription the App Store sells for a server. */
export function serverProductId(override: string | undefined): string {
  const trimmed = (override ?? "").trim();
  return trimmed === "" ? DEFAULT_PRODUCT_ID : trimmed;
}

type PeriodUnit = "day" | "week" | "month" | "year";
const PERIOD_UNITS: ReadonlyArray<string> = ["day", "week", "month", "year"];

/** What the screen reads of the App Store's product. */
export interface StoreProduct {
  readonly displayPrice: string;
  readonly subscriptionPeriodUnitIOS?: string | null;
  readonly subscriptionPeriodNumberIOS?: string | null;
  readonly introductoryPricePaymentModeIOS?: string | null;
  /** The whole length of the introductory offer, counted in the unit below. */
  readonly introductoryPriceNumberOfPeriodsIOS?: string | null;
  readonly introductoryPriceSubscriptionPeriodIOS?: string | null;
}

function period(count: string | null | undefined, unit: string | null | undefined) {
  const number = Number(count);
  return Number.isInteger(number) && number > 0 && PERIOD_UNITS.includes(unit ?? "")
    ? { count: number, unit: unit as PeriodUnit }
    : null;
}

/** The price as shown beside the button. */
export interface ServerOffer {
  readonly price: string;
  /** Said in place of the price while a free trial comes first. */
  readonly trial: string | null;
}

/**
 * The price and its period in the App Store's own words, or null when the product lacks either:
 * a price is never shown without how often it is charged.
 */
export function serverOffer(
  product: StoreProduct,
  /** False for someone who already used the introductory offer. */
  trialOpen: boolean,
): ServerOffer | null {
  const every = period(product.subscriptionPeriodNumberIOS, product.subscriptionPeriodUnitIOS);
  if (every === null || product.displayPrice.trim() === "") return null;
  const price =
    every.count === 1
      ? `${product.displayPrice} per ${every.unit}`
      : `${product.displayPrice} every ${every.count} ${every.unit}s`;
  const free =
    trialOpen && product.introductoryPricePaymentModeIOS === "free-trial"
      ? period(
          product.introductoryPriceNumberOfPeriodsIOS,
          product.introductoryPriceSubscriptionPeriodIOS,
        )
      : null;
  return {
    price,
    trial:
      free === null
        ? null
        : `Free for ${free.count} ${free.unit}${free.count === 1 ? "" : "s"}, then ${price}`,
  };
}

/** What the screen reads of one App Store purchase. */
export interface StorePurchase {
  readonly productId: string;
  readonly purchaseState: string;
  readonly transactionId?: string | null;
  readonly originalTransactionIdentifierIOS?: string | null;
}

/** The transaction to show the service for a paid purchase of the server; null for any other. */
export function paidTransaction(purchase: StorePurchase, productId: string): string | null {
  const { transactionId } = purchase;
  return purchase.productId === productId &&
    purchase.purchaseState === "purchased" &&
    typeof transactionId === "string" &&
    transactionId !== ""
    ? transactionId
    : null;
}

/** False for a renewal: the App Store hands one over each period, and its server already exists. */
export function isFirstPurchase(purchase: StorePurchase): boolean {
  const original = purchase.originalTransactionIdentifierIOS ?? null;
  return original === null || original === purchase.transactionId;
}

const error = (message: string): SignupNote => ({ kind: "error", message });
const info = (message: string): SignupNote => ({ kind: "info", message });

/** What to say when the App Store's sheet closes without a purchase; null when the person closed it. */
export function purchaseFailure(cause: unknown): SignupNote | null {
  const code =
    typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (code === "user-cancelled") return null;
  // Ask to Buy: the purchase arrives later, once it is approved.
  if (code === "deferred-payment" || code === "pending") {
    return info(MAJORDOME_SERVER.awaitingApproval);
  }
  return error(code === "network-error" ? NO_ANSWER_ERROR : MAJORDOME_SERVER.storeFailed);
}

interface BillingStatus {
  readonly live: boolean;
  /** Who takes the payment: only a subscription from Apple has to be cancelled on the phone. */
  readonly fromApple: boolean;
  readonly hasServer: boolean;
  readonly canBuy: boolean;
  /** Given to Apple with the purchase, so the service can tell whose it is. */
  readonly appToken: string;
}

export type BillingStatusResult =
  | { readonly kind: "status"; readonly status: BillingStatus }
  /** Servers are not sold yet. */
  | { readonly kind: "notOffered" }
  | { readonly kind: "failed"; readonly message: string };

export async function readBillingStatus(
  fetch: Fetch,
  broker: string,
  accountToken: string,
): Promise<BillingStatusResult> {
  const answer = await askBroker(fetch, broker, "/v1/billing/status", { accountToken });
  if (answer === null) return { kind: "failed", message: NO_ANSWER_ERROR };
  if (answer.status === 404) return { kind: "notOffered" };
  const body =
    typeof answer.body === "object" && answer.body !== null
      ? (answer.body as Record<string, unknown>)
      : {};
  const { state, appToken } = body;
  if (answer.status >= 400 || typeof state !== "string" || typeof appToken !== "string") {
    return { kind: "failed", message: signupErrorMessage(answer.body) };
  }
  const live = state === "active" || state === "past_due";
  return {
    kind: "status",
    status: {
      live,
      fromApple: body.source === "apple",
      hasServer: typeof body.server === "object" && body.server !== null,
      canBuy: body.canBuy === true,
      appToken,
    },
  };
}

/**
 * Whether the service takes purchases made through Apple, asked without an account: it then
 * refuses the account, or is not there. Asked before anything is sold, so nobody pays Apple for
 * a server the service would not make.
 */
export async function payingOffered(fetch: Fetch, broker: string): Promise<boolean> {
  const answer = await askBroker(fetch, broker, "/v1/billing/apple", {});
  return answer !== null && answer.status !== 404;
}

type BuyDecision =
  | { readonly buy: true; readonly appToken: string }
  | { readonly buy: false; readonly note: SignupNote };

/** Whether to open Apple's sheet for this account, and what to say when not. */
export function buyDecision(read: BillingStatusResult): BuyDecision {
  if (read.kind === "failed") return { buy: false, note: error(read.message) };
  if (read.kind === "notOffered") return { buy: false, note: error(MAJORDOME_SERVER.full) };
  const { status } = read;
  if (status.canBuy) return { buy: true, appToken: status.appToken };
  return {
    buy: false,
    note: status.live
      ? { kind: "hasServer", message: MAJORDOME_SERVER.hasServer }
      : error(MAJORDOME_SERVER.full),
  };
}

/**
 * Shows the service a purchase, which asks Apple whether it is this account's. Null once it is
 * confirmed; only then may the purchase be marked as delivered.
 */
export async function confirmApplePurchase(
  fetch: Fetch,
  broker: string,
  accountToken: string,
  transactionId: string,
): Promise<SignupNote | null> {
  const answer = await askBroker(fetch, broker, "/v1/billing/apple", {
    accountToken,
    transactionId,
  });
  if (answer === null) return error(MAJORDOME_SERVER.notConfirmed);
  if (answer.status < 400) return null;
  if (answer.status === 402) return error(MAJORDOME_SERVER.otherAccount);
  if (answer.status === 409) {
    return { kind: "hasServer", message: MAJORDOME_SERVER.alreadySubscribed };
  }
  return error(answer.status === 401 ? MAJORDOME_SERVER.signedOut : MAJORDOME_SERVER.notConfirmed);
}

/**
 * Ends the account's subscription where the service can and deletes its server. True when the
 * account can now be deleted, which includes an account that never had a server.
 */
export async function endServerBilling(
  fetch: Fetch,
  broker: string,
  accountToken: string,
): Promise<boolean> {
  const answer = await askBroker(fetch, broker, "/v1/billing/delete-account", { accountToken });
  return answer !== null && (answer.status < 400 || answer.status === 404);
}

/** What deleting the account takes with it, for the question asked before it. */
export function deleteAccountDetail(read: BillingStatusResult): string {
  if (read.kind !== "status") return MAJORDOME_ACCOUNT.deleteDetail;
  const { status } = read;
  if (status.live && status.fromApple) return MAJORDOME_ACCOUNT.deleteWithAppleServer;
  return status.live || status.hasServer
    ? MAJORDOME_ACCOUNT.deleteWithServer
    : MAJORDOME_ACCOUNT.deleteDetail;
}

export const alreadyConnectedNote = info(MAJORDOME_SERVER.alreadyConnected);
export const nothingToRestoreNote = info(MAJORDOME_SERVER.nothingToRestore);
export const awaitingApprovalNote = info(MAJORDOME_SERVER.awaitingApproval);
export const storeFailedNote = error(MAJORDOME_SERVER.storeFailed);
export const signedOutNote = error(MAJORDOME_SERVER.signedOut);
