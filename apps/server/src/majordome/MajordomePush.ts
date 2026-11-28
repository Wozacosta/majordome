/**
 * Notifications for the owner's devices, kept in this server's secret store. Browsers get Web
 * Push straight from here, signed with VAPID keys made once. The phone apps are reached through
 * the address service (`PhonePushRelay`). Nothing passes through T3 Connect.
 */

import {
  MajordomePhoneError,
  MajordomePhonePushDevice,
  type MajordomePhonePushRegistration,
  type MajordomePushConfig,
  type MajordomePushDevices,
  type MajordomePushSubscription,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A one-way hash, so a phone's token is never what names it in a list.
import * as NodeCrypto from "node:crypto";
import WebPush from "web-push";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as PhonePushRelay from "./PhonePushRelay.ts";
import type { VaultPushMessage } from "./pushDecision.ts";

const VAPID_SECRET = "majordome-web-push-vapid";
const SUBSCRIPTIONS_SECRET = "majordome-web-push-subscriptions";
// Apart from the browsers' list, so a server put back on an older version still reads its own.
const PHONES_SECRET = "majordome-phone-push-devices";
const PHONE_ENDPOINT_PREFIX = "phone:";
// Apple's push service rejects a VAPID subject on a localhost domain.
const VAPID_SUBJECT = "mailto:majordome@users.noreply.github.com";
const PUSH_TTL_SECONDS = 24 * 60 * 60;

const VapidKeys = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String });
const VapidKeysJson = Schema.fromJsonString(VapidKeys);

// Devices saved before labels existed have no `label` or `addedAt`.
const StoredSubscription = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
  label: Schema.optionalKey(Schema.String),
  addedAt: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
});
const StoredSubscriptionsJson = Schema.fromJsonString(Schema.Array(StoredSubscription));
type StoredSubscription = typeof StoredSubscription.Type;

const StoredPhone = Schema.Struct({
  device: MajordomePhonePushDevice,
  addedAt: Schema.String,
  sessionId: Schema.optionalKey(Schema.String),
});
const StoredPhonesJson = Schema.fromJsonString(Schema.Array(StoredPhone));
type StoredPhone = typeof StoredPhone.Type;

/** What names a phone in the device list: its kind and a hash of its token, never the token. */
export function phoneEndpoint(device: Pick<MajordomePhonePushDevice, "platform" | "token">) {
  const hash = NodeCrypto.createHash("sha256").update(device.token).digest("hex").slice(0, 32);
  return `${PHONE_ENDPOINT_PREFIX}${device.platform}:${hash}`;
}

/**
 * Adds a phone or refreshes it, keeping when it was first added. A phone has one access, so the
 * token it had before under that access is dropped: Apple and Google renew tokens now and then.
 */
function upsertPhone(
  phones: ReadonlyArray<StoredPhone>,
  phone: StoredPhone,
): ReadonlyArray<StoredPhone> {
  const endpoint = phoneEndpoint(phone.device);
  const previous = phones.find((existing) => phoneEndpoint(existing.device) === endpoint);
  const sessionId = phone.sessionId ?? previous?.sessionId;
  return [
    ...phones.filter(
      (existing) =>
        phoneEndpoint(existing.device) !== endpoint &&
        (sessionId === undefined ||
          existing.sessionId !== sessionId ||
          existing.device.platform !== phone.device.platform),
    ),
    {
      device: phone.device,
      addedAt: previous?.addedAt ?? phone.addedAt,
      ...(sessionId === undefined ? {} : { sessionId }),
    },
  ];
}

const PushPayloadJson = Schema.fromJsonString(
  Schema.Struct({
    title: Schema.String,
    body: Schema.String,
    tag: Schema.String,
    url: Schema.String,
  }),
);

const decodeVapidKeys = Schema.decodeEffect(VapidKeysJson);
const encodeVapidKeys = Schema.encodeEffect(VapidKeysJson);
const decodeSubscriptions = Schema.decodeEffect(StoredSubscriptionsJson);
const encodeSubscriptions = Schema.encodeEffect(StoredSubscriptionsJson);
const encodePushPayload = Schema.encodeEffect(PushPayloadJson);
const decodePhones = Schema.decodeEffect(StoredPhonesJson);
const encodePhones = Schema.encodeEffect(StoredPhonesJson);

const encodeText = (text: string) => new TextEncoder().encode(text);
const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Adds a device, or refreshes its keys when the browser renewed them, keeping when it was added. */
function upsertSubscription(
  subscriptions: ReadonlyArray<StoredSubscription>,
  subscription: StoredSubscription,
): ReadonlyArray<StoredSubscription> {
  const previous = subscriptions.find((existing) => existing.endpoint === subscription.endpoint);
  const label = subscription.label ?? previous?.label;
  const addedAt = previous?.addedAt ?? subscription.addedAt;
  const sessionId = subscription.sessionId ?? previous?.sessionId;
  return [
    ...subscriptions.filter((existing) => existing.endpoint !== subscription.endpoint),
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      ...(label === undefined ? {} : { label }),
      ...(addedAt === undefined ? {} : { addedAt }),
      ...(sessionId === undefined ? {} : { sessionId }),
    },
  ];
}

function isPushEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

type PushDelivery = "sent" | "gone" | "failed";

/** 404 and 410 mean the browser dropped the subscription, so the device is forgotten. */
function pushDeliveryForStatus(status: number): PushDelivery {
  if (status >= 200 && status < 300) return "sent";
  return status === 404 || status === 410 ? "gone" : "failed";
}

export class MajordomePush extends Context.Service<
  MajordomePush,
  {
    readonly getConfig: () => Effect.Effect<MajordomePushConfig, MajordomePhoneError>;
    readonly saveSubscription: (
      subscription: MajordomePushSubscription,
      label?: string,
      /** The access the device is using, so removing that access can stop its notifications. */
      sessionId?: string,
    ) => Effect.Effect<void, MajordomePhoneError>;
    /** A phone app's own notification address. The answer names it for `removeSubscription` and `sendTest`. */
    readonly registerPhone: (
      device: MajordomePhonePushDevice,
      sessionId?: string,
    ) => Effect.Effect<MajordomePhonePushRegistration, MajordomePhoneError>;
    /** Forgets a browser or a phone, by the name `listDevices` gives it. */
    readonly removeSubscription: (endpoint: string) => Effect.Effect<void, MajordomePhoneError>;
    readonly listDevices: () => Effect.Effect<MajordomePushDevices, MajordomePhoneError>;
    readonly sendTest: (endpoint: string) => Effect.Effect<void, MajordomePhoneError>;
    /** Sends to every device and returns how many accepted it; failures are logged, never raised. */
    readonly notifyAll: (message: VaultPushMessage) => Effect.Effect<number>;
  }
>()("t3/majordome/MajordomePush") {}

const storageError = (message: string) => (cause: unknown) =>
  new MajordomePhoneError({ message, cause });

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const httpClient = yield* HttpClient.HttpClient;
  const relay = yield* PhonePushRelay.PhonePushRelay;
  const lock = yield* Semaphore.make(1);

  const readVapidKeys = secrets.get(VAPID_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (bytes) => decodeVapidKeys(decodeText(bytes)),
      }),
    ),
  );

  const loadVapidKeys = Effect.gen(function* () {
    const existing = yield* readVapidKeys;
    if (existing !== null) return existing;
    const generated = WebPush.generateVAPIDKeys();
    const keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    const created = yield* secrets
      .create(VAPID_SECRET, encodeText(yield* encodeVapidKeys(keys)))
      .pipe(
        Effect.as(true),
        Effect.catchIf(ServerSecretStore.isSecretAlreadyExistsError, () => Effect.succeed(false)),
      );
    // Two first callers can race; the one that loses reads the winner's keys.
    return created ? keys : yield* readVapidKeys;
  }).pipe(Effect.mapError(storageError("Could not read this server's push keys.")));

  const cachedVapidKeys = yield* Ref.make<typeof VapidKeys.Type | null>(null);
  const vapidKeys = Effect.gen(function* () {
    const cached = yield* Ref.get(cachedVapidKeys);
    if (cached !== null) return cached;
    const keys = yield* loadVapidKeys;
    if (keys === null) {
      return yield* new MajordomePhoneError({ message: "Could not create push keys." });
    }
    yield* Ref.set(cachedVapidKeys, keys);
    return keys;
  });

  const readSubscriptions = secrets.get(SUBSCRIPTIONS_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<ReadonlyArray<StoredSubscription>>([]),
        onSome: (bytes) => decodeSubscriptions(decodeText(bytes)),
      }),
    ),
    Effect.mapError(storageError("Could not read the devices that get notifications.")),
  );

  const updateSubscriptions = (
    update: (current: ReadonlyArray<StoredSubscription>) => ReadonlyArray<StoredSubscription>,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = yield* encodeSubscriptions(update(yield* readSubscriptions)).pipe(
          Effect.mapError(storageError("Could not save the devices that get notifications.")),
        );
        yield* secrets
          .set(SUBSCRIPTIONS_SECRET, encodeText(next))
          .pipe(
            Effect.mapError(storageError("Could not save the devices that get notifications.")),
          );
      }),
    );

  const readPhones = secrets.get(PHONES_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<ReadonlyArray<StoredPhone>>([]),
        onSome: (bytes) => decodePhones(decodeText(bytes)),
      }),
    ),
    Effect.mapError(storageError("Could not read the phones that get notifications.")),
  );

  const updatePhones = (
    update: (current: ReadonlyArray<StoredPhone>) => ReadonlyArray<StoredPhone>,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = yield* encodePhones(update(yield* readPhones)).pipe(
          Effect.mapError(storageError("Could not save the phones that get notifications.")),
        );
        yield* secrets
          .set(PHONES_SECRET, encodeText(next))
          .pipe(Effect.mapError(storageError("Could not save the phones that get notifications.")));
      }),
    );

  const removeSubscription = Effect.fn("MajordomePush.removeSubscription")(function* (
    endpoint: string,
  ) {
    if (endpoint.startsWith(PHONE_ENDPOINT_PREFIX)) {
      yield* updatePhones((current) =>
        current.filter((phone) => phoneEndpoint(phone.device) !== endpoint),
      );
      return;
    }
    yield* updateSubscriptions((current) =>
      current.filter((subscription) => subscription.endpoint !== endpoint),
    );
  });

  /**
   * The devices to notify, after forgetting those whose access was removed or ran out. A device
   * saved before accesses were recorded stays until the owner removes it.
   */
  const liveDevices = Effect.fn("MajordomePush.liveDevices")(function* () {
    const subscriptions = yield* readSubscriptions;
    const phones = yield* readPhones;
    if ([...subscriptions, ...phones].every((device) => device.sessionId === undefined)) {
      return { subscriptions, phones };
    }
    const live = new Set<string>(
      (yield* auth
        .listSessions()
        .pipe(Effect.mapError(storageError("Could not read who still has access.")))).map(
        (session) => session.sessionId,
      ),
    );
    const isLive = (device: { readonly sessionId?: string }) =>
      device.sessionId === undefined || live.has(device.sessionId);
    const removed = subscriptions.filter((subscription) => !isLive(subscription));
    // By endpoint and access both: a device that signed in again meanwhile is kept.
    if (removed.length > 0) {
      yield* updateSubscriptions((current) =>
        current.filter(
          (subscription) =>
            !removed.some(
              (gone) =>
                gone.endpoint === subscription.endpoint &&
                gone.sessionId === subscription.sessionId,
            ),
        ),
      );
    }
    const removedPhones = phones.filter((phone) => !isLive(phone));
    if (removedPhones.length > 0) {
      yield* updatePhones((current) =>
        current.filter(
          (phone) =>
            !removedPhones.some(
              (gone) =>
                gone.device.token === phone.device.token && gone.sessionId === phone.sessionId,
            ),
        ),
      );
    }
    return { subscriptions: subscriptions.filter(isLive), phones: phones.filter(isLive) };
  });

  const deliver = Effect.fn("MajordomePush.deliver")(function* (
    subscription: StoredSubscription,
    message: VaultPushMessage,
  ) {
    const keys = yield* vapidKeys;
    const payload = yield* encodePushPayload(message).pipe(
      Effect.mapError(storageError("Could not write the notification.")),
    );
    const details = yield* Effect.try({
      try: () =>
        WebPush.generateRequestDetails(subscription, payload, {
          vapidDetails: { subject: VAPID_SUBJECT, ...keys },
          TTL: PUSH_TTL_SECONDS,
          urgency: "high",
          contentEncoding: "aes128gcm",
        }),
      catch: storageError("This device's notification keys are not valid."),
    });
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(details.endpoint).pipe(
          HttpClientRequest.setHeaders(details.headers),
          HttpClientRequest.bodyUint8Array(new Uint8Array(details.body ?? [])),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(storageError("Could not reach the device's notification service.")),
      );
    const delivery = pushDeliveryForStatus(response.status);
    if (delivery === "gone") yield* removeSubscription(subscription.endpoint);
    if (delivery === "failed") {
      yield* Effect.logWarning("Majordome's push service refused a notification.", {
        status: response.status,
        pushService: new URL(subscription.endpoint).host,
      });
    }
    return delivery;
  });

  /** Through the address service. A phone Apple or Google no longer knows is forgotten. */
  const deliverToPhone = Effect.fn("MajordomePush.deliverToPhone")(function* (
    phone: StoredPhone,
    message: VaultPushMessage,
  ) {
    const delivery = yield* relay.send(phone.device, message);
    if (delivery === "gone") yield* removeSubscription(phoneEndpoint(phone.device));
    return delivery;
  });

  const sendPhoneTest = Effect.fn("MajordomePush.sendPhoneTest")(function* (endpoint: string) {
    const phone = (yield* liveDevices()).phones.find(
      (entry) => phoneEndpoint(entry.device) === endpoint,
    );
    if (phone === undefined) {
      return yield* new MajordomePhoneError({
        message: "This phone isn't set up for notifications. Turn them on again.",
      });
    }
    const delivery = yield* deliverToPhone(phone, {
      title: "Majordome",
      body: "Notifications work on this phone.",
      tag: "majordome:test",
      url: "/feed",
    });
    if (delivery === "sent") return;
    return yield* new MajordomePhoneError({
      message:
        delivery === "gone"
          ? "This phone stopped accepting notifications. Turn them on again."
          : delivery === "unavailable"
            ? "This computer can't send notifications to the phone yet."
            : "The notification service refused the test. Try again later.",
    });
  });

  const sendTest = Effect.fn("MajordomePush.sendTest")(function* (endpoint: string) {
    if (endpoint.startsWith(PHONE_ENDPOINT_PREFIX)) return yield* sendPhoneTest(endpoint);
    const subscription = (yield* liveDevices()).subscriptions.find(
      (entry) => entry.endpoint === endpoint,
    );
    if (subscription === undefined) {
      return yield* new MajordomePhoneError({
        message: "This device isn't set up for notifications. Turn them on again.",
      });
    }
    const delivery = yield* deliver(subscription, {
      title: "Majordome",
      body: "Notifications work on this device.",
      tag: "majordome:test",
      url: "/feed",
    });
    if (delivery === "gone") {
      return yield* new MajordomePhoneError({
        message: "This device stopped accepting notifications. Turn them on again.",
      });
    }
    if (delivery === "failed") {
      return yield* new MajordomePhoneError({
        message: "The notification service refused the test. Try again later.",
      });
    }
  });

  const notifyAll = Effect.fn("MajordomePush.notifyAll")(
    function* (message: VaultPushMessage) {
      const { subscriptions, phones } = yield* liveDevices();
      const failed = (cause: unknown) =>
        Effect.logWarning("Majordome could not send a notification.", { cause }).pipe(
          Effect.as<PushDelivery>("failed"),
        );
      const deliveries = yield* Effect.forEach(
        [
          ...subscriptions.map((subscription) => deliver(subscription, message)),
          ...phones.map((phone) => deliverToPhone(phone, message)),
        ],
        Effect.catch(failed),
        { concurrency: 4 },
      );
      return deliveries.filter((delivery) => delivery === "sent").length;
    },
    Effect.catch((cause) =>
      Effect.logWarning("Majordome could not send notifications.", { cause }).pipe(Effect.as(0)),
    ),
  );

  return MajordomePush.of({
    getConfig: Effect.fn("MajordomePush.getConfig")(function* () {
      return { publicKey: (yield* vapidKeys).publicKey };
    }),
    saveSubscription: Effect.fn("MajordomePush.saveSubscription")(
      function* (subscription, label, sessionId) {
        if (!isPushEndpoint(subscription.endpoint)) {
          return yield* new MajordomePhoneError({
            message: "This browser gave a notification address Majordome can't use.",
          });
        }
        const addedAt = DateTime.formatIso(yield* DateTime.now);
        yield* updateSubscriptions((current) =>
          upsertSubscription(current, {
            ...subscription,
            ...(label === undefined ? {} : { label }),
            ...(sessionId === undefined ? {} : { sessionId }),
            addedAt,
          }),
        );
      },
    ),
    registerPhone: Effect.fn("MajordomePush.registerPhone")(function* (device, sessionId) {
      const addedAt = DateTime.formatIso(yield* DateTime.now);
      yield* updatePhones((current) =>
        upsertPhone(current, {
          device,
          addedAt,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
      return {
        endpoint: phoneEndpoint(device),
        canSend: (yield* relay.availability())[device.platform],
      };
    }),
    removeSubscription,
    listDevices: Effect.fn("MajordomePush.listDevices")(function* () {
      return {
        devices: [
          ...(yield* readSubscriptions).map((subscription) => ({
            endpoint: subscription.endpoint,
            label: subscription.label ?? null,
            addedAt: subscription.addedAt ?? null,
            sessionId: subscription.sessionId ?? null,
          })),
          ...(yield* readPhones).map((phone) => ({
            endpoint: phoneEndpoint(phone.device),
            label: phone.device.label ?? (phone.device.platform === "ios" ? "iPhone" : "Android"),
            addedAt: phone.addedAt,
            sessionId: phone.sessionId ?? null,
          })),
        ],
      };
    }),
    sendTest,
    notifyAll,
  });
});

export const layer = Layer.effect(MajordomePush, make);
