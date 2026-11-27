import { expect, it } from "vite-plus/test";

import { MAJORDOME_ACCOUNT, MAJORDOME_SERVER } from "./connectWording";
import { NO_ANSWER_ERROR } from "./hostedSignup.logic";
import {
  buyDecision,
  confirmApplePurchase,
  deleteAccountDetail,
  endServerBilling,
  isFirstPurchase,
  paidTransaction,
  payingOffered,
  paymentArrived,
  purchaseFailure,
  readBillingStatus,
  serverCheckout,
  serverOffer,
  serverProductId,
  webPayingOffered,
  webServerOffer,
  type BillingStatusResult,
} from "./serverPurchase.logic";

const PRODUCT = serverProductId(undefined);
const monthly = {
  displayPrice: "€9.99",
  subscriptionPeriodUnitIOS: "month",
  subscriptionPeriodNumberIOS: "1",
  introductoryPricePaymentModeIOS: "empty",
};
const weekFree = {
  ...monthly,
  introductoryPricePaymentModeIOS: "free-trial",
  introductoryPriceNumberOfPeriodsIOS: "1",
  introductoryPriceSubscriptionPeriodIOS: "week",
};

const answering = (status: number, body: unknown) => {
  const calls: Array<readonly [string, unknown]> = [];
  const fetch = async (url: string, init?: { readonly body?: string }) => {
    calls.push([url, JSON.parse(init?.body ?? "null")]);
    return {
      ok: status < 400,
      status,
      json: () => (body === undefined ? Promise.reject(new Error("empty")) : Promise.resolve(body)),
    };
  };
  return { fetch, calls };
};
const unreachable = () => Promise.reject(new TypeError("Network request failed"));

const status = (fields: Record<string, unknown>) => ({
  state: "none",
  source: null,
  canBuy: true,
  appToken: "0b0f6d0e-3c0e-4d0b-9b5a-3d7f1c2a9e11",
  server: null,
  ...fields,
});
const read = async (fields: Record<string, unknown>): Promise<BillingStatusResult> =>
  readBillingStatus(answering(200, status(fields)).fetch, "https://broker.test", "token-1");

it("uses Majordome's product unless the build names another", () => {
  expect(PRODUCT).toBe("io.github.wozacosta.majordome.server.monthly");
  expect(serverProductId("  ")).toBe(PRODUCT);
  expect(serverProductId(" com.example.server ")).toBe("com.example.server");
});

it("says the price and its period as the App Store gives them", () => {
  const cases: ReadonlyArray<readonly [string, object, boolean, unknown]> = [
    ["monthly", monthly, true, { price: "€9.99 per month", trial: null }],
    [
      "every three months",
      { ...monthly, displayPrice: "$24.99", subscriptionPeriodNumberIOS: "3" },
      true,
      { price: "$24.99 every 3 months", trial: null },
    ],
    [
      "a free week first",
      weekFree,
      true,
      { price: "€9.99 per month", trial: "Free for 1 week, then €9.99 per month" },
    ],
    [
      "a free trial counted in days",
      {
        ...weekFree,
        introductoryPriceNumberOfPeriodsIOS: "3",
        introductoryPriceSubscriptionPeriodIOS: "day",
      },
      true,
      { price: "€9.99 per month", trial: "Free for 3 days, then €9.99 per month" },
    ],
    ["a trial already used", weekFree, false, { price: "€9.99 per month", trial: null }],
    [
      "a cheaper first month is not a free trial",
      { ...weekFree, introductoryPricePaymentModeIOS: "pay-as-you-go" },
      true,
      { price: "€9.99 per month", trial: null },
    ],
    ["no period", { ...monthly, subscriptionPeriodUnitIOS: "empty" }, true, null],
    ["no price", { ...monthly, displayPrice: "" }, true, null],
  ];
  for (const [name, product, trialOpen, expected] of cases) {
    expect(serverOffer({ displayPrice: "", ...product }, trialOpen), name).toEqual(expected);
  }
});

it("takes only a paid purchase of the server to the service", () => {
  const bought = { productId: PRODUCT, purchaseState: "purchased", transactionId: "2000001" };
  expect(paidTransaction(bought, PRODUCT)).toBe("2000001");
  expect(paidTransaction({ ...bought, purchaseState: "pending" }, PRODUCT)).toBeNull();
  expect(paidTransaction({ ...bought, productId: "other" }, PRODUCT)).toBeNull();
  expect(paidTransaction({ ...bought, transactionId: null }, PRODUCT)).toBeNull();
  expect(isFirstPurchase(bought)).toBe(true);
  expect(isFirstPurchase({ ...bought, originalTransactionIdentifierIOS: "2000001" })).toBe(true);
  expect(isFirstPurchase({ ...bought, originalTransactionIdentifierIOS: "1000001" })).toBe(false);
});

it("tells a closed sheet and a purchase waiting for approval from a failure", () => {
  expect(purchaseFailure({ code: "user-cancelled" })).toBeNull();
  expect(purchaseFailure({ code: "deferred-payment" })).toEqual({
    kind: "info",
    message: MAJORDOME_SERVER.awaitingApproval,
  });
  expect(purchaseFailure({ code: "network-error" })).toEqual({
    kind: "error",
    message: NO_ANSWER_ERROR,
  });
  expect(purchaseFailure(new Error("boom"))).toEqual({
    kind: "error",
    message: MAJORDOME_SERVER.storeFailed,
  });
});

it("opens Apple's sheet only for an account that can buy", async () => {
  expect(buyDecision(await read({}))).toEqual({ buy: true, appToken: status({}).appToken });
  expect(
    buyDecision(await read({ state: "active", source: "web", canBuy: false, server: {} })),
  ).toEqual({ buy: false, note: { kind: "hasServer", message: MAJORDOME_SERVER.hasServer } });
  expect(buyDecision(await read({ canBuy: false }))).toEqual({
    buy: false,
    note: { kind: "error", message: MAJORDOME_SERVER.full },
  });
  expect(buyDecision(await readBillingStatus(unreachable, "b", "t"))).toEqual({
    buy: false,
    note: { kind: "error", message: NO_ANSWER_ERROR },
  });
  const { fetch, calls } = answering(404, { error: "invalid_request" });
  expect(await readBillingStatus(fetch, "https://broker.test", "token-1")).toEqual({
    kind: "notOffered",
  });
  expect(calls).toEqual([["https://broker.test/v1/billing/status", { accountToken: "token-1" }]]);
  expect((await readBillingStatus(answering(200, { state: "none" }).fetch, "b", "t")).kind).toBe(
    "failed",
  );
});

it("shows buying only while the service sells servers", async () => {
  expect(await payingOffered(answering(401, { error: "invalid_account" }).fetch, "b")).toBe(true);
  expect(await payingOffered(answering(404, { error: "invalid_request" }).fetch, "b")).toBe(false);
  expect(await payingOffered(unreachable, "b")).toBe(false);
});

it("reads the service's answer to a purchase", async () => {
  const cases: ReadonlyArray<readonly [number, unknown, unknown]> = [
    [204, undefined, null],
    [402, { error: "not_paid" }, { kind: "error", message: MAJORDOME_SERVER.otherAccount }],
    [
      409,
      { error: "already_subscribed" },
      { kind: "hasServer", message: MAJORDOME_SERVER.alreadySubscribed },
    ],
    [401, { error: "invalid_account" }, { kind: "error", message: MAJORDOME_SERVER.signedOut }],
    [502, { error: "upstream" }, { kind: "error", message: MAJORDOME_SERVER.notConfirmed }],
  ];
  for (const [code, body, expected] of cases) {
    const { fetch, calls } = answering(code, body);
    expect(await confirmApplePurchase(fetch, "https://broker.test", "token-1", "2000001")).toEqual(
      expected,
    );
    expect(calls).toEqual([
      [
        "https://broker.test/v1/billing/apple",
        { accountToken: "token-1", transactionId: "2000001" },
      ],
    ]);
  }
  expect(await confirmApplePurchase(unreachable, "b", "t", "1")).toEqual({
    kind: "error",
    message: MAJORDOME_SERVER.notConfirmed,
  });
});

it("deletes the account only once its server is dealt with", async () => {
  const { fetch, calls } = answering(204, undefined);
  expect(await endServerBilling(fetch, "https://broker.test", "token-1")).toBe(true);
  expect(calls).toEqual([
    ["https://broker.test/v1/billing/delete-account", { accountToken: "token-1" }],
  ]);
  expect(await endServerBilling(answering(404, {}).fetch, "b", "t")).toBe(true);
  expect(await endServerBilling(answering(502, { error: "upstream" }).fetch, "b", "t")).toBe(false);
  expect(await endServerBilling(unreachable, "b", "t")).toBe(false);
});

it("says what deleting the account takes with it", async () => {
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{}, MAJORDOME_ACCOUNT.deleteDetail],
    [{ state: "active", source: "apple", server: {} }, MAJORDOME_ACCOUNT.deleteWithAppleServer],
    [{ state: "past_due", source: "apple" }, MAJORDOME_ACCOUNT.deleteWithAppleServer],
    [{ state: "active", source: "web", server: {} }, MAJORDOME_ACCOUNT.deleteWithServer],
    // Ended with Apple: nothing is left to cancel there, but the stopped server still goes.
    [{ state: "ended", source: "apple", server: {} }, MAJORDOME_ACCOUNT.deleteWithServer],
  ];
  for (const [fields, expected] of cases) {
    expect(deleteAccountDetail(await read(fields)), JSON.stringify(fields)).toBe(expected);
  }
  expect(deleteAccountDetail({ kind: "notOffered" })).toBe(MAJORDOME_ACCOUNT.deleteDetail);
  expect(MAJORDOME_ACCOUNT.deleteWithAppleServer).toMatch(
    /Settings, under your name, then Subscriptions/,
  );
});

const webPrice = { amount: 1400, currency: "eur", interval: "month", trialDays: 0 };

it("says the website's price on Android once the account is known", async () => {
  expect(webServerOffer(null)).toEqual({ price: null, trial: null });
  expect(webServerOffer(webPrice, "en")).toEqual({ price: "€14 per month", trial: null });
  expect(webServerOffer({ ...webPrice, amount: 1450, trialDays: 7 }, "en")).toEqual({
    price: "€14.50 per month",
    trial: "Free for 7 days, then €14.50 per month",
  });
  const withOffer = await read({ offer: webPrice });
  expect(withOffer.kind === "status" && withOffer.status.web).toEqual(webPrice);
  const without = await read({ offer: null });
  expect(without.kind === "status" && without.status.web).toBeNull();
});

it("offers paying on the website only while the service sells there", async () => {
  expect(await webPayingOffered(answering(401, { error: "invalid_account" }).fetch, "b")).toBe(
    true,
  );
  expect(await webPayingOffered(answering(404, { error: "invalid_request" }).fetch, "b")).toBe(
    false,
  );
  expect(await webPayingOffered(unreachable, "b")).toBe(false);
});

it("asks the service for this account's payment page", async () => {
  const { fetch, calls } = answering(200, { url: "https://checkout.stripe.com/c/pay/1" });
  expect(await serverCheckout(fetch, "https://broker.test", "token-1")).toEqual({
    url: "https://checkout.stripe.com/c/pay/1",
  });
  expect(calls).toEqual([
    ["https://broker.test/v1/billing/checkout", { accountToken: "token-1", startedOn: "phone" }],
  ]);
  expect(
    await serverCheckout(answering(409, { error: "already_subscribed" }).fetch, "b", "t"),
  ).toEqual({ note: { kind: "hasServer", message: MAJORDOME_SERVER.hasServer } });
  expect(await serverCheckout(answering(503, { error: "full" }).fetch, "b", "t")).toMatchObject({
    note: { kind: "error" },
  });
  expect(await serverCheckout(answering(200, {}).fetch, "b", "t")).toMatchObject({
    note: { kind: "error" },
  });
  expect(await serverCheckout(unreachable, "b", "t")).toEqual({
    note: { kind: "error", message: NO_ANSWER_ERROR },
  });
});

it("waits a moment for a payment before saying none was found", async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  const answers = [read({}), read({}), read({ state: "active", source: "web" })];
  expect(await paymentArrived(() => answers.shift()!, wait)).toBe(true);
  expect(waits).toEqual([2000, 3000]);
  expect(await paymentArrived(() => read({}), wait, [0, 10])).toBe(false);
});
