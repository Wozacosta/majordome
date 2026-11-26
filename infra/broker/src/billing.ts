import { BrokerError } from "./errors.ts";
import { type HostClient, type HostedServer, launchServer, newServerName } from "./hosting.ts";
import { verifyStripeSignature } from "./stripe.ts";

/**
 * Who has paid for a server, and the one server made for them. Payment providers are only ever
 * asked how a subscription stands now: a notice from one names a subscription and nothing it says
 * is believed, so notices can arrive twice, late or out of order.
 */

export type Source = "web" | "apple";
export type PaidState = "none" | "active" | "past_due" | "ended";

export interface AccountRow {
  readonly accountId: string;
  readonly appToken: string;
  readonly source: Source | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly state: PaidState;
  readonly periodEnd: number | null;
  /** The customer cancelled: it runs to `periodEnd` and is not renewed. */
  readonly cancels: boolean;
  readonly appName: string | null;
  readonly claimedAt: number | null;
  readonly madeAt: number | null;
  readonly stoppedAt: number | null;
  readonly deleteAt: number | null;
  readonly wakeUntil: number | null;
  readonly wakes: number;
}

export type AccountPatch = Partial<Omit<AccountRow, "accountId">>;

/** How a provider says one subscription stands, in this service's words. */
export interface SubscriptionFacts {
  readonly source: Source;
  /** The account a web subscription was bought for. */
  readonly accountId?: string | undefined;
  /** The token an Apple purchase carried. */
  readonly appToken?: string | undefined;
  readonly customerId: string | null;
  readonly subscriptionId: string;
  readonly state: PaidState;
  readonly periodEnd: number | null;
  readonly cancels: boolean;
}

export interface AccountStore {
  readonly get: (accountId: string) => Promise<AccountRow | null>;
  readonly byToken: (appToken: string) => Promise<AccountRow | null>;
  readonly byCustomer: (customerId: string) => Promise<AccountRow | null>;
  /** The account's row, made with that token when it has none. */
  readonly ensure: (input: {
    readonly accountId: string;
    readonly appToken: string;
    readonly at: number;
  }) => Promise<AccountRow>;
  readonly patch: (accountId: string, patch: AccountPatch) => Promise<void>;
  /**
   * Takes the right to make the account's server under `appName`. False when another call holds
   * it; a claim older than `staleBefore` that made nothing is taken over, under the name it chose.
   */
  readonly claimServer: (input: {
    readonly accountId: string;
    readonly appName: string;
    readonly at: number;
    readonly staleBefore: number;
  }) => Promise<boolean>;
  /** Rows with a server, or with a subscription that should have one. */
  readonly open: () => Promise<ReadonlyArray<AccountRow>>;
  readonly serverNames: () => Promise<ReadonlyArray<string>>;
  /** Servers that are switched on, or being made: the ones that cost a full month. */
  readonly runningServers: (at: number) => Promise<number>;
  /** The account's first subscription and when it was bought. */
  readonly firstPurchase: (
    accountId: string,
  ) => Promise<{ readonly subscriptionId: string; readonly at: number } | null>;
  readonly logPurchase: (input: {
    readonly subscriptionId: string;
    readonly accountId: string;
    readonly source: Source;
    readonly startedOn: string | null;
    readonly at: number;
  }) => Promise<void>;
  readonly eventSeen: (id: string) => Promise<boolean>;
  readonly recordEvent: (input: {
    readonly id: string;
    readonly at: number;
    readonly forgetBefore: number;
  }) => Promise<void>;
}

export interface StripeClient {
  readonly createCheckout: (input: {
    readonly accountId: string;
    readonly email: string | null;
    readonly customerId: string | null;
    readonly trialDays: number;
    readonly startedOn: string;
  }) => Promise<{ readonly url: string }>;
  /** What the website sells: the price in the currency's smallest unit, and how often. */
  readonly offer: () => Promise<{
    readonly amount: number;
    readonly currency: string;
    readonly interval: string;
  }>;
  /** The subscription a finished checkout made, or null while it has made none. */
  readonly checkoutSubscription: (sessionId: string) => Promise<string | null>;
  readonly subscription: (subscriptionId: string) => Promise<
    SubscriptionFacts & {
      readonly startedOn: string | null;
    }
  >;
  /** Ends the subscription now. Ending one that has ended is not an error. */
  readonly cancel: (subscriptionId: string) => Promise<void>;
  readonly portal: (customerId: string) => Promise<{ readonly url: string }>;
  readonly chargeCustomer: (chargeId: string) => Promise<string | null>;
  /** Gives back in full every payment that customer made from `since` on. */
  readonly refundSince: (input: {
    readonly customerId: string;
    readonly since: number;
  }) => Promise<void>;
}

export interface AppleClient {
  /** How the subscription that transaction belongs to stands, or null when Apple knows none. */
  readonly subscription: (transactionId: string) => Promise<SubscriptionFacts | null>;
}

export interface PaidStatus {
  readonly state: PaidState;
  readonly source: Source | null;
  readonly periodEnd: number | null;
  readonly cancels: boolean;
  /** Until when the account can withdraw and be refunded in full; null when it cannot. */
  readonly withdrawUntil: number | null;
  /** Given to Apple with a purchase made in the phone app. */
  readonly appToken: string;
  /** False while a subscription is live, or while no new server can be made. */
  readonly canBuy: boolean;
  /** What the website sells to this account; null while paying there is not set up. */
  readonly offer: {
    readonly amount: number;
    readonly currency: string;
    readonly interval: string;
    readonly trialDays: number;
  } | null;
  readonly server: {
    readonly name: string;
    readonly url: string;
    readonly stopped: boolean;
    /** When a stopped server and its notes are deleted. */
    readonly deleteAt: number | null;
    readonly awakeUntil: number | null;
    readonly canWake: boolean;
  } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 3 * 60 * 1000;
const WAKE_MS = DAY_MS;
const MAX_WAKES = 3;
const EVENT_MEMORY_MS = 30 * DAY_MS;
const OVERDUE_MS = 2 * DAY_MS;
const WITHDRAW_MS = 14 * DAY_MS;
// A payment is taken a moment before this service hears of the subscription.
const PAID_BEFORE_HEARD_MS = 60 * 60 * 1000;
const MAX_SWEEP_ACTIONS = 8;

const isLive = (state: PaidState) => state === "active" || state === "past_due";

const full = () =>
  new BrokerError("full", "Majordome is not taking new servers right now. Try again later.");

export function makeBilling(deps: {
  readonly accounts: AccountStore;
  readonly host: HostClient;
  /** Null while that way of paying is not set up. */
  readonly stripe: StripeClient | null;
  readonly apple: AppleClient | null;
  readonly stripeWebhookSecret: string | null;
  readonly image: () => Promise<string>;
  /** Servers made from invites: they count toward the cap too. */
  readonly otherServers: () => Promise<number>;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly randomUUID: () => string;
  readonly config: {
    readonly namePrefix: string;
    readonly maxServers: number;
    readonly trialDays: number;
    readonly retentionDays: number;
  };
}) {
  const { accounts, host } = deps;

  const rowFor = (accountId: string) =>
    accounts.ensure({ accountId, appToken: deps.randomUUID(), at: deps.now() });

  /** One trial per account. */
  const trialFor = (row: AccountRow) => (row.subscriptionId === null ? deps.config.trialDays : 0);

  // A stopped server waiting out its retention costs its disk only, so it holds no place.
  const hasRoom = async () =>
    (await deps.otherServers()) + (await accounts.runningServers(deps.now())) <
    deps.config.maxServers;

  /**
   * The 14 days to change one's mind, counted from the account's first subscription. A later
   * subscription has none here, or subscribing again would be free for ever.
   */
  const withdrawUntil = async (row: AccountRow) => {
    if (row.source !== "web" || row.subscriptionId === null || !isLive(row.state)) return null;
    const first = await accounts.firstPurchase(row.accountId);
    if (first === null || first.subscriptionId !== row.subscriptionId) return null;
    const until = first.at + WITHDRAW_MS;
    return until > deps.now() ? until : null;
  };

  /** Makes the account's server, or returns the one it has. Safe to call from two places at once. */
  const makeServer = async (
    row: AccountRow,
  ): Promise<HostedServer | { name: string; url: string }> => {
    const at = deps.now();
    if (
      row.appName !== null &&
      (row.madeAt !== null || (row.claimedAt ?? 0) > at - STALE_CLAIM_MS)
    ) {
      return { name: row.appName, url: host.urlFor(row.appName) };
    }
    // No look at the places left: they are counted before the sale, and a paid server is owed.
    const name = row.appName ?? newServerName(deps.config.namePrefix, deps.randomBytes);
    const claimed = await accounts.claimServer({
      accountId: row.accountId,
      appName: name,
      at,
      staleBefore: at - STALE_CLAIM_MS,
    });
    if (!claimed) {
      const held = (await accounts.get(row.accountId))?.appName;
      if (held == null) throw new BrokerError("upstream", "Your server is being made. Try again.");
      return { name: held, url: host.urlFor(held) };
    }
    try {
      // A claim taken over may have left half a server behind under this name.
      if (row.appName !== null) await host.deleteServer(name);
      const server = await launchServer(deps, name, row.accountId);
      await accounts.patch(row.accountId, { madeAt: deps.now(), stoppedAt: null, deleteAt: null });
      return server;
    } catch (error) {
      await host.deleteServer(name).catch(() => undefined);
      await accounts.patch(row.accountId, { appName: null, claimedAt: null });
      throw error;
    }
  };

  /**
   * Brings the account's server to where its subscription says it should be: made and running
   * while paid, stopped when it ends, deleted after the retention period. True when it acted.
   */
  const settle = async (accountId: string): Promise<boolean> => {
    const row = await accounts.get(accountId);
    if (row === null) return false;
    const at = deps.now();
    const live = isLive(row.state);
    const beingMade = row.appName !== null && (row.claimedAt ?? 0) > at - STALE_CLAIM_MS;
    if (row.madeAt === null) {
      if (beingMade || (row.appName === null && !live)) return false;
      if (live) {
        await makeServer(row);
        return true;
      }
      // It ended while its server was half made: the name and whatever exists under it go.
      if (row.appName !== null) await host.deleteServer(row.appName);
      await accounts.patch(accountId, { appName: null, claimedAt: null });
      return true;
    }
    if (row.appName === null) return false;
    if (live) {
      if (row.stoppedAt === null) return false;
      await host.startServer(row.appName);
      await accounts.patch(accountId, { stoppedAt: null, deleteAt: null, wakeUntil: null });
      return true;
    }
    if (row.deleteAt !== null && row.deleteAt <= at) {
      await host.deleteServer(row.appName);
      await accounts.patch(accountId, {
        appName: null,
        claimedAt: null,
        madeAt: null,
        stoppedAt: null,
        deleteAt: null,
        wakeUntil: null,
        wakes: 0,
      });
      return true;
    }
    if (row.stoppedAt === null || (row.wakeUntil !== null && row.wakeUntil <= at)) {
      await host.stopServer(row.appName);
      await accounts.patch(accountId, {
        stoppedAt: row.stoppedAt ?? at,
        deleteAt: row.deleteAt ?? at + deps.config.retentionDays * DAY_MS,
        wakeUntil: null,
      });
      return true;
    }
    return false;
  };

  /**
   * Writes down how a subscription stands. Returns the account it belongs to, or "duplicate" for
   * a second subscription bought while the account's first is still live.
   */
  const record = async (
    facts: SubscriptionFacts,
    startedOn: string | null,
  ): Promise<{ readonly accountId: string } | "duplicate" | null> => {
    const row =
      facts.accountId !== undefined
        ? await rowFor(facts.accountId)
        : facts.appToken !== undefined
          ? await accounts.byToken(facts.appToken)
          : null;
    if (row === null) return null;
    const same = row.subscriptionId === facts.subscriptionId;
    if (!same && isLive(row.state)) return isLive(facts.state) ? "duplicate" : null;
    // An old subscription ending says nothing about the account once it has had a newer one.
    if (!same && !isLive(facts.state)) return null;
    await accounts.patch(row.accountId, {
      source: facts.source,
      customerId: facts.customerId ?? row.customerId,
      subscriptionId: facts.subscriptionId,
      state: facts.state,
      periodEnd: facts.periodEnd,
      cancels: facts.cancels,
    });
    if (!same) {
      await accounts.logPurchase({
        subscriptionId: facts.subscriptionId,
        accountId: row.accountId,
        source: facts.source,
        startedOn,
        at: deps.now(),
      });
    }
    return { accountId: row.accountId };
  };

  const stripe = () => {
    if (deps.stripe === null) throw new BrokerError("invalid_request", "Nothing is served here.");
    return deps.stripe;
  };

  /** Asks Stripe how that subscription stands and writes it down. */
  const refreshWeb = async (subscriptionId: string) => {
    const { startedOn, ...facts } = await stripe().subscription(subscriptionId);
    const recorded = await record(facts, startedOn);
    // Two checkouts were open at once and both were paid: the second is ended at once.
    if (recorded === "duplicate") await stripe().cancel(subscriptionId);
    return recorded === "duplicate" ? null : recorded;
  };

  const refreshApple = async (transactionId: string) => {
    const facts = await deps.apple?.subscription(transactionId);
    if (facts === null || facts === undefined) return null;
    const recorded = await record(facts, "phone");
    return recorded === "duplicate" ? null : recorded;
  };

  const refresh = (row: AccountRow) =>
    row.subscriptionId === null
      ? null
      : row.source === "apple"
        ? refreshApple(row.subscriptionId)
        : refreshWeb(row.subscriptionId);

  /** Ends a web subscription now: a dispute, a full refund, or the account being deleted. */
  const endNow = async (row: AccountRow) => {
    if (row.source !== "web" || row.subscriptionId === null || !isLive(row.state)) return;
    await stripe().cancel(row.subscriptionId);
    await refreshWeb(row.subscriptionId);
  };

  return {
    settle,
    /** Whether purchases made in the phone app are taken. */
    takesApple: deps.apple !== null,

    status: async (accountId: string): Promise<PaidStatus> => {
      const row = await rowFor(accountId);
      const at = deps.now();
      return {
        state: row.state,
        source: row.source,
        periodEnd: row.periodEnd,
        cancels: row.cancels,
        withdrawUntil: await withdrawUntil(row),
        appToken: row.appToken,
        canBuy: !isLive(row.state) && (row.appName !== null || (await hasRoom())),
        offer:
          deps.stripe === null
            ? null
            : { ...(await deps.stripe.offer()), trialDays: trialFor(row) },
        // A server still being made is not one yet: whoever asks goes on making it.
        server:
          row.appName === null || row.madeAt === null
            ? null
            : {
                name: row.appName,
                url: host.urlFor(row.appName),
                stopped: row.stoppedAt !== null && (row.wakeUntil ?? 0) <= at,
                deleteAt: row.deleteAt,
                awakeUntil: row.wakeUntil,
                canWake: row.stoppedAt !== null && row.wakes < MAX_WAKES,
              },
      };
    },

    /** Where the signed-in person goes to pay. Refused while they already have a subscription. */
    checkout: async (input: {
      readonly accountId: string;
      readonly email: string | null;
      readonly startedOn: string;
    }): Promise<{ readonly url: string }> => {
      const row = await rowFor(input.accountId);
      if (isLive(row.state)) {
        throw new BrokerError("already_subscribed", "This account already has a server.");
      }
      if (row.appName === null && !(await hasRoom())) throw full();
      return stripe().createCheckout({
        accountId: input.accountId,
        email: input.email,
        customerId: row.source === "web" ? row.customerId : null,
        trialDays: trialFor(row),
        startedOn: input.startedOn,
      });
    },

    /** Stripe's own page for the card, the invoices and cancelling. */
    portal: async (accountId: string): Promise<{ readonly url: string }> => {
      const row = await accounts.get(accountId);
      if (row?.source !== "web" || row.customerId === null) {
        throw new BrokerError("not_paid", "This account has nothing to manage here.");
      }
      return stripe().portal(row.customerId);
    },

    /**
     * The account's server, made now if it is paid for and not made yet. `checkoutSession` is
     * what the payment page handed back: with it this does not wait for Stripe's own notice.
     */
    server: async (input: {
      readonly accountId: string;
      readonly checkoutSession?: string | undefined;
    }) => {
      if (input.checkoutSession !== undefined) {
        const subscriptionId = await stripe().checkoutSubscription(input.checkoutSession);
        if (subscriptionId !== null) await refreshWeb(subscriptionId);
      }
      const row = await accounts.get(input.accountId);
      if (row === null || !isLive(row.state)) {
        throw new BrokerError("not_paid", "This account has no server yet.");
      }
      const server = await makeServer(row);
      await settle(input.accountId);
      return server;
    },

    /** A purchase made in the phone app. Apple is asked; the phone is not believed. */
    applePurchase: async (input: {
      readonly accountId: string;
      readonly transactionId: string;
    }) => {
      const row = await rowFor(input.accountId);
      const facts = await deps.apple?.subscription(input.transactionId);
      if (facts === null || facts === undefined || facts.appToken !== row.appToken) {
        throw new BrokerError("not_paid", "Apple does not list that purchase for this account.");
      }
      if ((await record(facts, "phone")) === "duplicate") {
        throw new BrokerError(
          "already_subscribed",
          "This account already pays for its server on the website.",
        );
      }
    },

    /** Apple's notice about a subscription. Only the transaction it names is used. */
    appleNotice: async (transactionId: string) => (await refreshApple(transactionId))?.accountId,

    /**
     * A notice from Stripe. Returns the account whose server may need to change, for the caller
     * to settle once Stripe has its answer.
     */
    stripeEvent: async (input: {
      readonly body: string;
      readonly signature: string | null;
    }): Promise<string | null> => {
      const valid =
        deps.stripeWebhookSecret !== null &&
        (await verifyStripeSignature({
          body: input.body,
          header: input.signature,
          secret: deps.stripeWebhookSecret,
          nowSeconds: Math.floor(deps.now() / 1000),
        }));
      if (!valid) throw new BrokerError("invalid_proof", "That notice is not from Stripe.");
      const event = JSON.parse(input.body) as {
        readonly id?: unknown;
        readonly type?: unknown;
        readonly data?: { readonly object?: Record<string, unknown> };
      };
      const object = event.data?.object ?? {};
      if (typeof event.id !== "string" || (await accounts.eventSeen(event.id))) return null;
      const text = (value: unknown) => (typeof value === "string" ? value : null);
      let accountId: string | null = null;
      if (event.type === "checkout.session.completed") {
        const subscriptionId = text(object.subscription);
        if (subscriptionId !== null)
          accountId = (await refreshWeb(subscriptionId))?.accountId ?? null;
      } else if (
        typeof event.type === "string" &&
        event.type.startsWith("customer.subscription.")
      ) {
        const subscriptionId = text(object.id);
        if (subscriptionId !== null)
          accountId = (await refreshWeb(subscriptionId))?.accountId ?? null;
      } else if (
        event.type === "charge.dispute.created" ||
        (event.type === "charge.refunded" && object.refunded === true)
      ) {
        const chargeId = text(event.type === "charge.refunded" ? object.id : object.charge);
        const customerId =
          text(object.customer) ??
          (chargeId === null ? null : await stripe().chargeCustomer(chargeId));
        const row = customerId === null ? null : await accounts.byCustomer(customerId);
        if (row !== null) {
          await endNow(row);
          accountId = row.accountId;
        }
      }
      const at = deps.now();
      await accounts.recordEvent({ id: event.id, at, forgetBefore: at - EVENT_MEMORY_MS });
      return accountId;
    },

    /**
     * The customer changes their mind in the first 14 days: what they paid is given back, the
     * subscription ends now and the server is stopped, kept as after any ending.
     */
    withdraw: async (accountId: string) => {
      const row = await accounts.get(accountId);
      const until = row === null ? null : await withdrawUntil(row);
      if (row === null || until === null || row.subscriptionId === null) {
        throw new BrokerError(
          "invalid_request",
          "The 14 days to change your mind are over. You can still cancel.",
        );
      }
      // The refund first: if ending fails after it, Stripe's notice of the refund ends it.
      if (row.customerId !== null) {
        await stripe().refundSince({
          customerId: row.customerId,
          since: until - WITHDRAW_MS - PAID_BEFORE_HEARD_MS,
        });
      }
      await stripe().cancel(row.subscriptionId);
      await refreshWeb(row.subscriptionId);
      await settle(accountId);
    },

    /** Switches a stopped server on for a day, so its owner can get their notes out. */
    wake: async (accountId: string) => {
      const row = await accounts.get(accountId);
      if (row?.appName == null || row.stoppedAt === null || row.wakes >= MAX_WAKES) {
        throw new BrokerError("invalid_request", "This server cannot be switched on from here.");
      }
      await host.startServer(row.appName);
      await accounts.patch(accountId, {
        wakeUntil: deps.now() + WAKE_MS,
        wakes: row.wakes + 1,
      });
    },

    /**
     * The account is being deleted: a web subscription ends now and the server goes with its
     * notes. An Apple subscription can only be cancelled by its owner, on their iPhone.
     */
    deleteAccount: async (accountId: string) => {
      const row = await accounts.get(accountId);
      if (row === null) return;
      await endNow(row);
      // A new token, so a later notice from Apple about the old purchase finds no account.
      await accounts.patch(accountId, {
        state: "ended",
        deleteAt: deps.now(),
        appToken: deps.randomUUID(),
      });
      await settle(accountId);
    },

    /**
     * The hourly pass: finishes what a notice started, stops what has ended, deletes what has
     * waited out the retention period, and asks the provider again about a subscription whose
     * paid period ran out with no notice.
     */
    sweep: async () => {
      const at = deps.now();
      const report = { settled: [] as Array<string>, failed: [] as Array<string> };
      for (const row of await accounts.open()) {
        if (report.settled.length + report.failed.length >= MAX_SWEEP_ACTIONS) break;
        try {
          const overdue =
            isLive(row.state) && row.periodEnd !== null && row.periodEnd < at - OVERDUE_MS;
          if (overdue) await refresh(row);
          if ((await settle(row.accountId)) || overdue) report.settled.push(row.accountId);
        } catch (error) {
          console.error("Could not settle a hosted account", row.accountId, error);
          report.failed.push(row.accountId);
        }
      }
      return report;
    },
  };
}

export type Billing = ReturnType<typeof makeBilling>;
