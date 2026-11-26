import { describe, expect, it } from "vite-plus/test";

import { appleFacts, noticeTransaction } from "./apple.ts";
import {
  type AccountRow,
  type AccountStore,
  makeBilling,
  type PaidState,
  type SubscriptionFacts,
} from "./billing.ts";
import { BrokerError } from "./errors.ts";
import { type HostClient, HostError } from "./hosting.ts";
import { subscriptionFacts, verifyStripeSignature } from "./stripe.ts";

const START = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "whsec_test";
const ACCOUNT = "user_ada";

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function sign(body: string, atMs: number, secret = SECRET) {
  const seconds = Math.floor(atMs / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${seconds}.${body}`));
  return `t=${seconds},v1=${hex(mac)},v0=ignored`;
}

function makeAccounts() {
  const rows = new Map<string, AccountRow>();
  const events = new Set<string>();
  const purchases: Array<{
    subscriptionId: string;
    accountId: string;
    source: string;
    startedOn: string | null;
    at: number;
  }> = [];
  const find = (test: (row: AccountRow) => boolean) => [...rows.values()].find(test) ?? null;
  const store: AccountStore = {
    get: async (accountId) => rows.get(accountId) ?? null,
    byToken: async (appToken) => find((row) => row.appToken === appToken),
    byCustomer: async (customerId) => find((row) => row.customerId === customerId),
    ensure: async ({ accountId, appToken }) => {
      const row = rows.get(accountId) ?? {
        accountId,
        appToken,
        source: null,
        customerId: null,
        subscriptionId: null,
        state: "none" as const,
        periodEnd: null,
        cancels: false,
        appName: null,
        claimedAt: null,
        madeAt: null,
        stoppedAt: null,
        deleteAt: null,
        wakeUntil: null,
        wakes: 0,
      };
      rows.set(accountId, row);
      return row;
    },
    patch: async (accountId, patch) => {
      const row = rows.get(accountId);
      if (row !== undefined) rows.set(accountId, { ...row, ...patch });
    },
    claimServer: async ({ accountId, appName, at, staleBefore }) => {
      const row = rows.get(accountId);
      const free =
        row !== undefined &&
        (row.appName === null ||
          (row.appName === appName && row.madeAt === null && (row.claimedAt ?? 0) <= staleBefore));
      if (free) rows.set(accountId, { ...row, appName, claimedAt: at });
      return free;
    },
    open: async () =>
      [...rows.values()].filter(
        (row) => row.appName !== null || row.state === "active" || row.state === "past_due",
      ),
    serverNames: async () => [...rows.values()].flatMap((row) => row.appName ?? []),
    runningServers: async (at) =>
      [...rows.values()].filter(
        (row) => row.appName !== null && (row.stoppedAt === null || (row.wakeUntil ?? 0) > at),
      ).length,
    firstPurchase: async (accountId) =>
      purchases.find((purchase) => purchase.accountId === accountId) ?? null,
    logPurchase: async (purchase) => {
      purchases.push(purchase);
    },
    eventSeen: async (id) => events.has(id),
    recordEvent: async ({ id }) => {
      events.add(id);
    },
  };
  return { store, rows, purchases };
}

interface WebSubscription {
  status: string;
  cancel_at_period_end: boolean;
  periodEnd: number;
  account: string;
  customer: string;
}

function setup(options: { readonly maxServers?: number; readonly invited?: number } = {}) {
  const clock = { now: START };
  const accounts = makeAccounts();
  const machines = new Map<string, "started" | "stopped">();
  const made: Array<string> = [];
  const deleted: Array<string> = [];
  const fail = { create: false };
  const host: HostClient = {
    createServer: async ({ name, env }) => {
      if (fail.create) throw new HostError(422, "no capacity");
      made.push(`${name}:${env.MAJORDOME_OWNER_ACCOUNT}`);
      machines.set(name, "started");
      return { url: `https://${name}.example` };
    },
    deleteServer: async (name) => {
      if (machines.delete(name)) deleted.push(name);
    },
    urlFor: (name) => `https://${name}.example`,
    updateServer: async () => undefined,
    isSwitchedOn: async (name) => machines.get(name) === "started",
    stopServer: async (name) => {
      machines.set(name, "stopped");
    },
    startServer: async (name) => {
      machines.set(name, "started");
    },
  };
  const subscriptions = new Map<string, WebSubscription>();
  const checkouts: Array<{ trialDays: number; customerId: string | null }> = [];
  const cancelled: Array<string> = [];
  const refunds: Array<{ customerId: string; since: number }> = [];
  const appleSubscriptions = new Map<string, SubscriptionFacts>();
  let seed = 0;
  let uuid = 0;
  const billing = makeBilling({
    accounts: accounts.store,
    host,
    stripe: {
      offer: async () => ({ amount: 2000, currency: "eur", interval: "month" }),
      createCheckout: async ({ trialDays, customerId }) => {
        checkouts.push({ trialDays, customerId });
        return { url: "https://checkout.stripe.example/c/1" };
      },
      checkoutSubscription: async (sessionId) => (sessionId === "cs_paid" ? "sub_1" : null),
      subscription: async (id) => {
        const subscription = subscriptions.get(id);
        if (subscription === undefined) throw new HostError(404, "No such subscription");
        return subscriptionFacts({
          id,
          status: subscription.status,
          customer: subscription.customer,
          cancel_at_period_end: subscription.cancel_at_period_end,
          metadata: { account: subscription.account, started_on: "computer" },
          items: { data: [{ current_period_end: subscription.periodEnd / 1000 }] },
        });
      },
      cancel: async (id) => {
        cancelled.push(id);
        const subscription = subscriptions.get(id);
        if (subscription !== undefined) subscription.status = "canceled";
      },
      portal: async (customerId) => ({ url: `https://billing.stripe.example/${customerId}` }),
      chargeCustomer: async (chargeId) => (chargeId === "ch_1" ? "cus_1" : null),
      refundSince: async (refund) => {
        refunds.push(refund);
      },
    },
    apple: { subscription: async (id) => appleSubscriptions.get(id) ?? null },
    stripeWebhookSecret: SECRET,
    image: async () => "ghcr.io/wozacosta/majordome@sha256:ab",
    otherServers: async () => options.invited ?? 0,
    now: () => clock.now,
    randomBytes: (length) => Uint8Array.from({ length }, () => seed++ % 256),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    config: {
      namePrefix: "majordome-",
      maxServers: options.maxServers ?? 5,
      trialDays: 7,
      retentionDays: 30,
    },
  });

  const subscribe = (id = "sub_1", change: Partial<WebSubscription> = {}) => {
    subscriptions.set(id, {
      status: "trialing",
      cancel_at_period_end: false,
      periodEnd: clock.now + 7 * DAY,
      account: ACCOUNT,
      customer: "cus_1",
      ...subscriptions.get(id),
      ...change,
    });
  };
  /** Stripe's notice, signed as Stripe signs it, then the settling the Worker does after it. */
  const notify = async (id: string, type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ id, type, data: { object } });
    const accountId = await billing.stripeEvent({ body, signature: await sign(body, clock.now) });
    if (accountId !== null) await billing.settle(accountId);
  };
  const subscriptionNotice = (eventId: string, type: string, id = "sub_1") =>
    notify(eventId, `customer.subscription.${type}`, { id, object: "subscription" });
  const row = () => accounts.rows.get(ACCOUNT);

  return {
    billing,
    clock,
    machines,
    made,
    deleted,
    fail,
    checkouts,
    cancelled,
    refunds,
    subscriptions,
    appleSubscriptions,
    purchases: accounts.purchases,
    subscribe,
    notify,
    subscriptionNotice,
    row,
  };
}

describe("paying on the website", () => {
  it("makes one server whether the page or Stripe's notice comes first, however often", async () => {
    for (const pageFirst of [true, false]) {
      const t = setup();
      t.subscribe();
      const page = () => t.billing.server({ accountId: ACCOUNT, checkoutSession: "cs_paid" });
      const notice = () =>
        t.notify("evt_1", "checkout.session.completed", { id: "cs_paid", subscription: "sub_1" });
      if (pageFirst) expect(await page()).toHaveProperty("pairingUrl");
      await notice();
      await notice();
      const again = await page();
      await t.subscriptionNotice("evt_2", "created");

      expect(t.made).toEqual([`${again.name}:${ACCOUNT}`]);
      expect(t.row()).toMatchObject({ state: "active", source: "web", customerId: "cus_1" });
      expect(t.purchases).toEqual([
        expect.objectContaining({ subscriptionId: "sub_1", source: "web", startedOn: "computer" }),
      ]);
    }
  });

  it("makes nothing for an account that has not paid, or whose checkout was abandoned", async () => {
    const t = setup();
    await expect(t.billing.server({ accountId: ACCOUNT })).rejects.toMatchObject({
      code: "not_paid",
    });
    await expect(
      t.billing.server({ accountId: ACCOUNT, checkoutSession: "cs_open" }),
    ).rejects.toMatchObject({ code: "not_paid" });
    expect(t.made).toEqual([]);
  });

  it("refuses a notice Stripe did not sign, and one signed too long ago", async () => {
    const t = setup();
    t.subscribe();
    const body = JSON.stringify({
      id: "evt_1",
      type: "customer.subscription.created",
      data: { object: { id: "sub_1" } },
    });
    for (const signature of [
      null,
      "t=1,v1=00",
      await sign(body, t.clock.now, "whsec_other"),
      await sign(body, t.clock.now - 6 * 60 * 1000),
      (await sign(`${body} `, t.clock.now)).replace("ignored", "x"),
    ]) {
      await expect(t.billing.stripeEvent({ body, signature })).rejects.toBeInstanceOf(BrokerError);
    }
    expect(t.row()).toBeUndefined();
  });

  it("offers one subscription and one trial per account", async () => {
    const t = setup();
    await t.billing.checkout({ accountId: ACCOUNT, email: "ada@example.com", startedOn: "phone" });
    t.subscribe();
    await t.subscriptionNotice("evt_1", "created");
    await expect(
      t.billing.checkout({ accountId: ACCOUNT, email: null, startedOn: "phone" }),
    ).rejects.toMatchObject({ code: "already_subscribed" });
    expect(await t.billing.status(ACCOUNT)).toMatchObject({
      canBuy: false,
      offer: { amount: 2000, currency: "eur", interval: "month", trialDays: 0 },
    });

    // A second checkout was already open in another tab and was paid too.
    t.subscribe("sub_2");
    await t.subscriptionNotice("evt_2", "created", "sub_2");
    expect(t.cancelled).toEqual(["sub_2"]);
    expect(t.row()).toMatchObject({ subscriptionId: "sub_1", state: "active" });
    expect(t.made).toHaveLength(1);

    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_3", "deleted");
    await t.billing.checkout({ accountId: ACCOUNT, email: null, startedOn: "computer" });
    expect(t.checkouts).toEqual([
      { trialDays: 7, customerId: null },
      { trialDays: 0, customerId: "cus_1" },
    ]);
  });

  it("sells nothing once every place is taken", async () => {
    const t = setup({ maxServers: 2, invited: 2 });
    await expect(
      t.billing.checkout({ accountId: ACCOUNT, email: null, startedOn: "computer" }),
    ).rejects.toMatchObject({ code: "full" });
    expect((await t.billing.status(ACCOUNT)).canBuy).toBe(false);

    // The last place went while this account was on the payment page: it paid, so it is served.
    t.subscribe();
    await t.subscriptionNotice("evt_1", "created");
    await t.billing.sweep();
    expect(t.made).toHaveLength(1);
  });

  it("counts a stopped server as no place taken, and one switched back on as one", async () => {
    const t = setup({ maxServers: 1 });
    t.subscribe();
    await t.subscriptionNotice("evt_1", "created");
    const other = () => t.billing.status("user_bob").then((status) => status.canBuy);
    expect(await other()).toBe(false);

    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_2", "deleted");
    expect(await other()).toBe(true);

    await t.billing.wake(ACCOUNT);
    expect(await other()).toBe(false);
  });

  it("gives the place back when the host fails, and takes over a making that died half-way", async () => {
    const t = setup();
    t.subscribe();
    t.fail.create = true;
    await expect(
      t.billing.server({ accountId: ACCOUNT, checkoutSession: "cs_paid" }),
    ).rejects.toBeInstanceOf(HostError);
    expect(t.row()).toMatchObject({ appName: null, state: "active" });

    t.fail.create = false;
    await t.billing.sweep();
    expect(t.made).toHaveLength(1);

    // The Worker stopped between taking the name and making the machine.
    const name = t.row()?.appName;
    Object.assign(t.row() ?? {}, { madeAt: null });
    expect(await t.billing.server({ accountId: ACCOUNT })).toEqual({
      name,
      url: `https://${name}.example`,
    });
    expect(t.made).toHaveLength(1);
    // Until it is made the account is shown no server, and the hourly pass leaves a fresh claim.
    expect((await t.billing.status(ACCOUNT)).server).toBeNull();
    await t.billing.sweep();
    expect(t.made).toHaveLength(1);
    t.clock.now += 4 * 60 * 1000;
    expect(await t.billing.sweep()).toEqual({ settled: [ACCOUNT], failed: [] });
    expect(t.made).toEqual([`${name}:${ACCOUNT}`, `${name}:${ACCOUNT}`]);
    expect((await t.billing.status(ACCOUNT)).server).toMatchObject({ name, stopped: false });

    // It ended while half made: the name is given up, so it holds no place.
    Object.assign(t.row() ?? {}, { madeAt: null, state: "ended" });
    t.clock.now += 4 * 60 * 1000;
    await t.billing.sweep();
    expect(t.row()).toMatchObject({ appName: null, claimedAt: null });
    expect(t.deleted).toContain(name);
  });
});

describe("a subscription ending", () => {
  const running = async () => {
    const t = setup();
    t.subscribe();
    await t.subscriptionNotice("evt_1", "created");
    const name = t.row()?.appName ?? "";
    return { ...t, name };
  };

  it("cancelled: runs to the end of the paid period, is stopped, and deleted a month later", async () => {
    const t = await running();
    t.subscribe("sub_1", { status: "active", cancel_at_period_end: true });
    await t.subscriptionNotice("evt_2", "updated");
    expect(t.machines.get(t.name)).toBe("started");
    expect(await t.billing.status(ACCOUNT)).toMatchObject({ state: "active", cancels: true });

    t.clock.now += 7 * DAY;
    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_3", "deleted");
    expect(t.machines.get(t.name)).toBe("stopped");
    expect(await t.billing.status(ACCOUNT)).toMatchObject({
      state: "ended",
      server: { stopped: true, deleteAt: t.clock.now + 30 * DAY, canWake: true },
    });

    t.clock.now += 29 * DAY;
    await t.billing.sweep();
    expect(t.deleted).toEqual([]);
    t.clock.now += DAY;
    await t.billing.sweep();
    expect(t.deleted).toEqual([t.name]);
    expect(t.row()).toMatchObject({ appName: null, state: "ended", subscriptionId: "sub_1" });
  });

  it("failed payment: keeps running while Stripe retries, is stopped when Stripe gives up", async () => {
    const t = await running();
    t.subscribe("sub_1", { status: "past_due" });
    await t.subscriptionNotice("evt_2", "updated");
    expect(t.machines.get(t.name)).toBe("started");
    expect(t.row()?.state).toBe("past_due");

    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_3", "deleted");
    expect(t.machines.get(t.name)).toBe("stopped");
    expect(t.deleted).toEqual([]);
  });

  it("dispute or full refund: the subscription is ended and the server stopped at once", async () => {
    for (const [type, object] of [
      ["charge.dispute.created", { id: "dp_1", charge: "ch_1" }],
      ["charge.refunded", { id: "ch_1", customer: "cus_1", refunded: true }],
    ] as const) {
      const t = await running();
      t.subscribe("sub_1", { status: "active" });
      await t.notify("evt_2", type, object);
      expect(t.cancelled).toEqual(["sub_1"]);
      expect(t.machines.get(t.name)).toBe("stopped");
      expect(t.row()?.state).toBe("ended");
    }
  });

  it("changing one's mind in the first 14 days: refunded, ended and stopped at once", async () => {
    const t = await running();
    expect((await t.billing.status(ACCOUNT)).withdrawUntil).toBe(START + 14 * DAY);

    // The trial is over and the first month is paid.
    t.clock.now += 9 * DAY;
    t.subscribe("sub_1", { status: "active" });
    await t.billing.withdraw(ACCOUNT);
    expect(t.refunds).toEqual([{ customerId: "cus_1", since: START - 60 * 60 * 1000 }]);
    expect(t.cancelled).toEqual(["sub_1"]);
    expect(t.machines.get(t.name)).toBe("stopped");
    expect(await t.billing.status(ACCOUNT)).toMatchObject({
      state: "ended",
      withdrawUntil: null,
      server: { stopped: true, canWake: true },
    });
    await expect(t.billing.withdraw(ACCOUNT)).rejects.toBeInstanceOf(BrokerError);
    expect(t.refunds).toHaveLength(1);
  });

  it("no refund after 14 days, for a second subscription, or for one bought from Apple", async () => {
    const late = await running();
    late.clock.now += 14 * DAY;
    expect((await late.billing.status(ACCOUNT)).withdrawUntil).toBeNull();
    await expect(late.billing.withdraw(ACCOUNT)).rejects.toBeInstanceOf(BrokerError);

    const again = await running();
    again.subscribe("sub_1", { status: "canceled" });
    await again.subscriptionNotice("evt_2", "deleted");
    again.subscribe("sub_2", { status: "active" });
    await again.subscriptionNotice("evt_3", "created", "sub_2");
    await expect(again.billing.withdraw(ACCOUNT)).rejects.toBeInstanceOf(BrokerError);

    for (const t of [late, again]) {
      expect(t.refunds).toEqual([]);
      expect(t.machines.get(t.name)).toBe("started");
    }
  });

  it("a partial refund changes nothing", async () => {
    const t = await running();
    await t.notify("evt_2", "charge.refunded", { id: "ch_1", customer: "cus_1", refunded: false });
    expect(t.cancelled).toEqual([]);
    expect(t.machines.get(t.name)).toBe("started");
  });

  it("a notice that never arrived is caught by asking Stripe once the period is two days over", async () => {
    const t = await running();
    t.subscribe("sub_1", { status: "canceled" });
    t.clock.now += 8 * DAY;
    await t.billing.sweep();
    expect(t.machines.get(t.name)).toBe("started");
    t.clock.now += 2 * DAY;
    await t.billing.sweep();
    expect(t.machines.get(t.name)).toBe("stopped");
  });

  it("paying again before the server is deleted switches the same server back on", async () => {
    const t = await running();
    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_2", "deleted");
    t.clock.now += 3 * DAY;
    t.subscribe("sub_2", { status: "active" });
    await t.subscriptionNotice("evt_3", "created", "sub_2");
    // The first subscription's ending, delivered late, must not end the second.
    await t.subscriptionNotice("evt_4", "updated", "sub_1");

    expect(t.machines.get(t.name)).toBe("started");
    expect(t.made).toHaveLength(1);
    expect(t.row()).toMatchObject({ state: "active", stoppedAt: null, deleteAt: null });
  });

  it("a stopped server can be switched on for a day, three times, to get the notes out", async () => {
    const t = await running();
    await expect(t.billing.wake(ACCOUNT)).rejects.toBeInstanceOf(BrokerError);
    t.subscribe("sub_1", { status: "canceled" });
    await t.subscriptionNotice("evt_2", "deleted");
    const deleteAt = t.row()?.deleteAt;

    for (let wake = 0; wake < 3; wake++) {
      await t.billing.wake(ACCOUNT);
      expect(t.machines.get(t.name)).toBe("started");
      await t.billing.sweep();
      expect(t.machines.get(t.name)).toBe("started");
      t.clock.now += DAY;
      await t.billing.sweep();
      expect(t.machines.get(t.name)).toBe("stopped");
    }
    await expect(t.billing.wake(ACCOUNT)).rejects.toBeInstanceOf(BrokerError);
    expect(t.row()?.deleteAt).toBe(deleteAt);
  });

  it("deleting the account ends the subscription and deletes the server", async () => {
    const t = await running();
    const token = t.row()?.appToken;
    await t.billing.deleteAccount(ACCOUNT);
    expect(t.cancelled).toEqual(["sub_1"]);
    expect(t.deleted).toEqual([t.name]);
    expect(t.row()).toMatchObject({ state: "ended", appName: null });
    expect(t.row()?.appToken).not.toBe(token);
  });
});

describe("paying in the iPhone app", () => {
  const apple = (token: string, state: PaidState = "active"): SubscriptionFacts => ({
    source: "apple",
    appToken: token,
    customerId: null,
    subscriptionId: "2000000111",
    state,
    periodEnd: START + 30 * DAY,
    cancels: false,
  });
  const bought = async () => {
    const t = setup();
    const { appToken } = await t.billing.status(ACCOUNT);
    t.appleSubscriptions.set("2000000111", apple(appToken));
    // A renewal has its own transaction, in the same subscription.
    t.appleSubscriptions.set("2000000222", apple(appToken));
    const buy = async (transactionId = "2000000111") => {
      await t.billing.applePurchase({ accountId: ACCOUNT, transactionId });
      return t.billing.server({ accountId: ACCOUNT });
    };
    const notice = async (state: PaidState) => {
      t.appleSubscriptions.set("2000000111", apple(appToken, state));
      const accountId = await t.billing.appleNotice("2000000111");
      if (accountId !== undefined) await t.billing.settle(accountId);
    };
    return { ...t, appToken, buy, notice };
  };

  it("makes one server for a purchase Apple lists, and none again on Restore", async () => {
    const t = await bought();
    const server = await t.buy();
    expect(await t.buy()).toMatchObject({ name: server.name });
    expect(await t.buy("2000000222")).toMatchObject({ name: server.name });
    expect(t.made).toHaveLength(1);
    expect(t.purchases).toEqual([expect.objectContaining({ source: "apple", startedOn: "phone" })]);
    await expect(
      t.billing.checkout({ accountId: ACCOUNT, email: null, startedOn: "computer" }),
    ).rejects.toMatchObject({ code: "already_subscribed" });
  });

  it("refuses a purchase Apple does not know, and another account's purchase", async () => {
    const t = await bought();
    await expect(t.buy("2000000999")).rejects.toMatchObject({ code: "not_paid" });
    await expect(
      t.billing.applePurchase({ accountId: "user_eve", transactionId: "2000000111" }),
    ).rejects.toMatchObject({ code: "not_paid" });
    expect(t.made).toEqual([]);
  });

  it("renewal, billing grace, expiry and refund each end as on the website", async () => {
    const t = await bought();
    const { name } = await t.buy();
    await t.notice("active");
    await t.notice("past_due");
    expect(t.machines.get(name)).toBe("started");
    await t.notice("ended");
    expect(t.machines.get(name)).toBe("stopped");
    expect(t.deleted).toEqual([]);
    // Apple got the payment through after all.
    await t.notice("active");
    expect(t.machines.get(name)).toBe("started");
    expect(t.made).toHaveLength(1);
  });

  it("ignores a notice about a purchase no account made", async () => {
    const t = setup();
    t.appleSubscriptions.set("2000000111", apple("11111111-1111-4111-8111-111111111111"));
    expect(await t.billing.appleNotice("2000000111")).toBeUndefined();
    expect(await t.billing.appleNotice("2000000999")).toBeUndefined();
  });

  const signed = (payload: unknown) => `e30.${btoa(JSON.stringify(payload))}.sig`;
  const statusResponse = (status: number, renewal: Record<string, unknown> = {}) => ({
    environment: "Sandbox",
    bundleId: "io.github.wozacosta.majordome.ios",
    data: [
      {
        subscriptionGroupIdentifier: "21000000",
        lastTransactions: [
          {
            status,
            originalTransactionId: "2000000111",
            signedTransactionInfo: signed({
              bundleId: "io.github.wozacosta.majordome.ios",
              productId: "server.monthly",
              originalTransactionId: "2000000111",
              appAccountToken: "0C0FFEE0-0000-4000-8000-000000000001",
              expiresDate: START + 30 * DAY,
            }),
            signedRenewalInfo: signed({ autoRenewStatus: 1, ...renewal }),
          },
        ],
      },
    ],
  });
  const ours = { bundleId: "io.github.wozacosta.majordome.ios", productId: "server.monthly" };

  it("reads Apple's answer: running, in grace, in retry, expired, refunded", () => {
    expect(appleFacts(statusResponse(1), ours)).toEqual({
      source: "apple",
      appToken: "0c0ffee0-0000-4000-8000-000000000001",
      customerId: null,
      subscriptionId: "2000000111",
      state: "active",
      periodEnd: START + 30 * DAY,
      cancels: false,
    });
    expect(
      appleFacts(statusResponse(4, { gracePeriodExpiresDate: START + 46 * DAY }), ours),
    ).toMatchObject({ state: "past_due", periodEnd: START + 46 * DAY });
    expect(appleFacts(statusResponse(1, { autoRenewStatus: 0 }), ours)?.cancels).toBe(true);
    for (const status of [2, 3, 5]) {
      expect(appleFacts(statusResponse(status), ours)?.state).toBe("ended");
    }
  });

  it("reads nothing from an answer about another app or another product", () => {
    expect(appleFacts(statusResponse(1), { ...ours, bundleId: "com.example.other" })).toBeNull();
    expect(appleFacts(statusResponse(1), { ...ours, productId: "other" })).toBeNull();
  });

  it("takes only the transaction from a notice", () => {
    const notice = {
      signedPayload: signed({
        notificationType: "REFUND",
        data: { signedTransactionInfo: signed({ originalTransactionId: "2000000111" }) },
      }),
    };
    expect(noticeTransaction(notice)).toBe("2000000111");
    expect(noticeTransaction({ signedPayload: "nonsense" })).toBeNull();
    expect(noticeTransaction({ signedPayload: signed({ data: {} }) })).toBeNull();
    expect(noticeTransaction(null)).toBeNull();
  });
});

describe("Stripe's words", () => {
  it("reads a subscription's state and period from either place Stripe has put it", () => {
    const base = { id: "sub_1", customer: "cus_1", metadata: { account: ACCOUNT } };
    expect(
      subscriptionFacts({
        ...base,
        status: "trialing",
        items: { data: [{ current_period_end: 1800 }] },
      }),
    ).toMatchObject({ state: "active", periodEnd: 1_800_000, accountId: ACCOUNT, cancels: false });
    expect(
      subscriptionFacts({ ...base, status: "active", current_period_end: 1900, cancel_at: 1900 }),
    ).toMatchObject({ state: "active", periodEnd: 1_900_000, cancels: true });
    for (const [status, state] of [
      ["past_due", "past_due"],
      ["canceled", "ended"],
      ["unpaid", "ended"],
      ["paused", "ended"],
      ["incomplete", "none"],
    ] as const) {
      expect(subscriptionFacts({ ...base, status }).state).toBe(state);
    }
  });

  it("accepts any of several signatures while a secret is being rolled", async () => {
    const body = "{}";
    const header = await sign(body, START);
    const check = (value: string) =>
      verifyStripeSignature({ body, header: value, secret: SECRET, nowSeconds: START / 1000 });
    expect(await check(header.replace("v1=", `v1=${"0".repeat(64)},v1=`))).toBe(true);
    expect(await check(header.replace(/v1=[0-9a-f]{4}/u, "v1=0000"))).toBe(false);
  });
});
