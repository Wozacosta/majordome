/**
 * Web Push for the installed web app. This server's VAPID keys are made once and kept in its
 * secret store, next to the devices that asked for notifications. Pushes go straight to each
 * browser's push service; nothing passes through T3 Connect.
 */

import {
  MajordomePhoneError,
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
import WebPush from "web-push";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import type { VaultPushMessage } from "./pushDecision.ts";

const VAPID_SECRET = "majordome-web-push-vapid";
const SUBSCRIPTIONS_SECRET = "majordome-web-push-subscriptions";
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
});
const StoredSubscriptionsJson = Schema.fromJsonString(Schema.Array(StoredSubscription));
type StoredSubscription = typeof StoredSubscription.Type;

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
  return [
    ...subscriptions.filter((existing) => existing.endpoint !== subscription.endpoint),
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      ...(label === undefined ? {} : { label }),
      ...(addedAt === undefined ? {} : { addedAt }),
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
    ) => Effect.Effect<void, MajordomePhoneError>;
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
  const httpClient = yield* HttpClient.HttpClient;
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

  const removeSubscription = Effect.fn("MajordomePush.removeSubscription")(function* (
    endpoint: string,
  ) {
    yield* updateSubscriptions((current) =>
      current.filter((subscription) => subscription.endpoint !== endpoint),
    );
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

  const sendTest = Effect.fn("MajordomePush.sendTest")(function* (endpoint: string) {
    const subscription = (yield* readSubscriptions).find((entry) => entry.endpoint === endpoint);
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
      const subscriptions = yield* readSubscriptions;
      const deliveries = yield* Effect.forEach(
        subscriptions,
        (subscription) =>
          deliver(subscription, message).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Majordome could not send a notification.", { cause }).pipe(
                Effect.as<PushDelivery>("failed"),
              ),
            ),
          ),
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
    saveSubscription: Effect.fn("MajordomePush.saveSubscription")(function* (subscription, label) {
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
          addedAt,
        }),
      );
    }),
    removeSubscription,
    listDevices: Effect.fn("MajordomePush.listDevices")(function* () {
      return {
        devices: (yield* readSubscriptions).map((subscription) => ({
          endpoint: subscription.endpoint,
          label: subscription.label ?? null,
          addedAt: subscription.addedAt ?? null,
        })),
      };
    }),
    sendTest,
    notifyAll,
  });
});

export const layer = Layer.effect(MajordomePush, make);
