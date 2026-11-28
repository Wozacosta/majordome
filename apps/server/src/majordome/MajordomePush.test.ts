import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { MajordomePhonePushDevice } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import WebPush from "web-push";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as MajordomePush from "./MajordomePush.ts";
import * as PhonePushRelay from "./PhonePushRelay.ts";

interface SentPush {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: number;
}

type LiveSessions = Effect.Success<
  ReturnType<EnvironmentAuth.EnvironmentAuth["Service"]["listSessions"]>
>;

/**
 * A push service that answers each endpoint with the status the test chose, on a server where
 * `liveSessions` are the accesses not removed.
 */
const pushService = (
  sent: Array<SentPush>,
  statusFor: (url: string) => number,
  liveSessions: () => ReadonlyArray<string> = () => [],
  relay: PhonePushRelay.PhonePushRelay["Service"] = noRelay,
) =>
  Layer.mergeAll(
    Layer.succeed(PhonePushRelay.PhonePushRelay, relay),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      listSessions: () =>
        Effect.succeed(
          liveSessions().map((sessionId) => ({ sessionId })) as unknown as LiveSessions,
        ),
    }),
    httpLayer(sent, statusFor),
  );

/** A server with no address service: no kind of phone can be reached. */
const noRelay = PhonePushRelay.PhonePushRelay.of({
  availability: () => Effect.succeed({ ios: false, android: false }),
  send: () => Effect.succeed("unavailable"),
});

/** An address service that answers each phone's token with what the test chose. */
const relayAnswering = (
  sent: Array<{ readonly token: string; readonly title: string }>,
  deliveryFor: (token: string) => PhonePushRelay.PhonePushDelivery,
) =>
  PhonePushRelay.PhonePushRelay.of({
    availability: () => Effect.succeed({ ios: true, android: false }),
    send: (device, message) =>
      Effect.sync(() => {
        sent.push({ token: device.token, title: message.title });
        return deliveryFor(device.token);
      }),
  });

const iphone = (token: string): MajordomePhonePushDevice => ({
  platform: "ios",
  token,
  bundleId: "io.github.wozacosta.majordome.ios",
  apnsEnvironment: "production",
  label: "iPhone · Majordome app",
});

const httpLayer = (sent: Array<SentPush>, statusFor: (url: string) => number) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        sent.push({
          url: request.url,
          headers: request.headers,
          bytes: request.body._tag === "Uint8Array" ? request.body.body.byteLength : 0,
        });
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, { status: statusFor(request.url) }),
        );
      }),
    ),
  );

const storeLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-push-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

/** A browser's subscription: a P-256 public key and a 16-byte auth secret, as browsers make. */
const browserSubscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: WebPush.generateVAPIDKeys().publicKey, auth: "c2VjcmV0LWF1dGgtMTIzNA" },
});

it.layer(storeLayer)("MajordomePush", (it) => {
  it.effect("makes VAPID keys once and keeps them across restarts", () =>
    Effect.gen(function* () {
      const sent: Array<SentPush> = [];
      const first = yield* MajordomePush.make.pipe(Effect.provide(pushService(sent, () => 201)));
      const { publicKey } = yield* first.getConfig();
      assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/);

      const restarted = yield* MajordomePush.make.pipe(
        Effect.provide(pushService(sent, () => 201)),
      );
      assert.equal((yield* restarted.getConfig()).publicKey, publicKey);
    }),
  );

  it.effect(
    "sends each saved device an encrypted, VAPID-signed push and forgets devices that are gone",
    () =>
      Effect.gen(function* () {
        const sent: Array<SentPush> = [];
        const push = yield* MajordomePush.make.pipe(
          Effect.provide(pushService(sent, (url) => (url.includes("gone") ? 410 : 201))),
        );
        const { publicKey } = yield* push.getConfig();
        const phone = browserSubscription("https://push.example/phone");
        yield* push.saveSubscription(phone);
        yield* push.saveSubscription(browserSubscription("https://push.example/gone"));
        // Saving the same device again replaces it rather than adding a second copy.
        yield* push.saveSubscription(browserSubscription("https://push.example/phone"));

        const sentTo = yield* push.notifyAll({
          title: "Couldn't finish",
          body: "Start my day",
          tag: "majordome:thread-1",
          url: "/threads/env/thread-1",
        });
        assert.equal(sentTo, 1);

        assert.deepEqual(sent.map((request) => request.url).toSorted(), [
          "https://push.example/gone",
          "https://push.example/phone",
        ]);
        for (const request of sent) {
          assert.equal(request.headers["content-encoding"], "aes128gcm");
          assert.match(request.headers.authorization ?? "", /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
          assert.include(request.headers.authorization ?? "", `k=${publicKey}`);
          assert.isAbove(request.bytes, 0);
        }

        sent.length = 0;
        yield* push.notifyAll({ title: "Start my day", body: "Hi", tag: "t", url: "/feed" });
        assert.deepEqual(
          sent.map((request) => request.url),
          ["https://push.example/phone"],
        );

        yield* push.removeSubscription("https://push.example/phone");
        sent.length = 0;
        yield* push.notifyAll({ title: "Start my day", body: "Hi", tag: "t", url: "/feed" });
        assert.lengthOf(sent, 0);
      }),
  );

  it.effect("forgets a device once the access it used is removed, before sending", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set("majordome-web-push-subscriptions", new TextEncoder().encode("[]"));
      const sent: Array<SentPush> = [];
      const live = ["session-phone", "session-tablet"];
      const push = yield* MajordomePush.make.pipe(
        Effect.provide(
          pushService(
            sent,
            () => 201,
            () => live,
          ),
        ),
      );
      const endpoints = () =>
        push.listDevices().pipe(Effect.map(({ devices }) => devices.map((d) => d.endpoint)));
      yield* push.saveSubscription(browserSubscription("https://push.example/before-sessions"));
      yield* push.saveSubscription(
        browserSubscription("https://push.example/phone"),
        "Phone",
        "session-phone",
      );
      yield* push.saveSubscription(
        browserSubscription("https://push.example/tablet"),
        "Tablet",
        "session-tablet",
      );
      const message = { title: "Start my day", body: "Hi", tag: "t", url: "/feed" };
      assert.equal(yield* push.notifyAll(message), 3);

      live.pop();
      sent.length = 0;
      assert.equal(yield* push.notifyAll(message), 2);
      assert.deepEqual(sent.map((request) => request.url).toSorted(), [
        "https://push.example/before-sessions",
        "https://push.example/phone",
      ]);
      assert.deepEqual(yield* endpoints(), [
        "https://push.example/before-sessions",
        "https://push.example/phone",
      ]);

      live.pop();
      sent.length = 0;
      assert.isTrue(
        Exit.isFailure(yield* Effect.exit(push.sendTest("https://push.example/phone"))),
      );
      assert.lengthOf(sent, 0);
      yield* secrets.set("majordome-web-push-subscriptions", new TextEncoder().encode("[]"));
    }),
  );

  it.effect("lists devices with their labels, reading devices saved before labels existed", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const old = browserSubscription("https://push.example/old");
      yield* secrets.set(
        "majordome-web-push-subscriptions",
        new TextEncoder().encode(JSON.stringify([old])),
      );
      const push = yield* MajordomePush.make.pipe(Effect.provide(pushService([], () => 201)));
      yield* push.saveSubscription(
        browserSubscription("https://push.example/labelled"),
        "iPhone · Safari",
        "session-phone",
      );
      const { devices } = yield* push.listDevices();
      assert.deepEqual(
        devices.map(({ endpoint, label }) => [endpoint, label]),
        [
          ["https://push.example/old", null],
          ["https://push.example/labelled", "iPhone · Safari"],
        ],
      );
      assert.isNull(devices[0]?.addedAt);
      const addedAt = devices[1]?.addedAt ?? null;
      assert.isString(addedAt);

      // Renewed keys keep the device's name, the time it was added and the access it used.
      yield* push.saveSubscription(browserSubscription("https://push.example/labelled"));
      const renewed = (yield* push.listDevices()).devices.find(
        (device) => device.endpoint === "https://push.example/labelled",
      );
      assert.deepEqual(renewed, {
        endpoint: "https://push.example/labelled",
        label: "iPhone · Safari",
        addedAt,
        sessionId: "session-phone",
      });
    }),
  );

  it.effect("refuses addresses that are not a push service's and tests only saved devices", () =>
    Effect.gen(function* () {
      const push = yield* MajordomePush.make.pipe(Effect.provide(pushService([], () => 201)));
      const refused = yield* Effect.exit(
        push.saveSubscription(browserSubscription("http://192.168.1.10/internal")),
      );
      assert.isTrue(Exit.isFailure(refused));
      const untested = yield* Effect.exit(push.sendTest("https://push.example/unknown"));
      assert.isTrue(Exit.isFailure(untested));
    }),
  );

  it.effect(
    "keeps a phone app next to the browsers, without its token, and forgets a gone one",
    () =>
      Effect.gen(function* () {
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        yield* secrets.set("majordome-web-push-subscriptions", new TextEncoder().encode("[]"));
        const sentToBrowsers: Array<SentPush> = [];
        const sentToPhones: Array<{ readonly token: string; readonly title: string }> = [];
        const live = ["session-phone", "session-other"];
        const push = yield* MajordomePush.make.pipe(
          Effect.provide(
            pushService(
              sentToBrowsers,
              () => 201,
              () => live,
              relayAnswering(sentToPhones, (token) => (token === "token-gone" ? "gone" : "sent")),
            ),
          ),
        );
        yield* push.saveSubscription(browserSubscription("https://push.example/browser"));

        const phone = yield* push.registerPhone(iphone("token-1"), "session-phone");
        assert.deepEqual(phone, {
          endpoint: MajordomePush.phoneEndpoint(iphone("token-1")),
          canSend: true,
        });
        assert.notInclude(phone.endpoint, "token-1");
        // Android has no credentials on this address service.
        const android = yield* push.registerPhone(
          { platform: "android", token: "token-gone" },
          "session-other",
        );
        assert.isFalse(android.canSend);

        const listed = (yield* push.listDevices()).devices;
        assert.deepEqual(
          listed.map(({ endpoint, label, sessionId }) => [endpoint, label, sessionId]),
          [
            ["https://push.example/browser", null, null],
            [phone.endpoint, "iPhone · Majordome app", "session-phone"],
            [android.endpoint, "Android", "session-other"],
          ],
        );
        assert.notInclude(JSON.stringify(listed), "token-");

        const message = { title: "Start my day", body: "Hi", tag: "t", url: "/feed" };
        assert.equal(yield* push.notifyAll(message), 2);
        assert.deepEqual(sentToPhones.map((sent) => sent.token).toSorted(), [
          "token-1",
          "token-gone",
        ]);
        const endpoints = () =>
          push.listDevices().pipe(Effect.map(({ devices }) => devices.map((d) => d.endpoint)));
        assert.deepEqual(yield* endpoints(), ["https://push.example/browser", phone.endpoint]);

        // Apple renewed the token: the phone's one access keeps one entry, added when it first was.
        const renewed = yield* push.registerPhone(iphone("token-2"), "session-phone");
        assert.deepEqual(yield* endpoints(), ["https://push.example/browser", renewed.endpoint]);

        sentToPhones.length = 0;
        yield* push.sendTest(renewed.endpoint);
        assert.deepEqual(sentToPhones, [{ token: "token-2", title: "Majordome" }]);

        // Removing the phone's access stops its notifications, as for a browser.
        live.shift();
        sentToPhones.length = 0;
        assert.equal(yield* push.notifyAll(message), 1);
        assert.lengthOf(sentToPhones, 0);
        assert.deepEqual(yield* endpoints(), ["https://push.example/browser"]);

        // The computer's page removes a phone by the same action as a browser.
        const again = yield* push.registerPhone(iphone("token-3"));
        yield* push.removeSubscription(again.endpoint);
        assert.deepEqual(yield* endpoints(), ["https://push.example/browser"]);
        yield* secrets.set("majordome-web-push-subscriptions", new TextEncoder().encode("[]"));
      }),
  );

  it.effect("keeps a phone it cannot reach yet, sends it nothing, and says so on a test", () =>
    Effect.gen(function* () {
      const push = yield* MajordomePush.make.pipe(Effect.provide(pushService([], () => 201)));
      const phone = yield* push.registerPhone(iphone("token-unreachable"));
      assert.isFalse(phone.canSend);
      assert.equal(
        yield* push.notifyAll({ title: "Start my day", body: "Hi", tag: "t", url: "/feed" }),
        0,
      );
      assert.include(
        (yield* push.listDevices()).devices.map((device) => device.endpoint),
        phone.endpoint,
      );
      const test = yield* Effect.flip(push.sendTest(phone.endpoint));
      assert.equal(test.message, "This computer can't send notifications to the phone yet.");
      yield* push.removeSubscription(phone.endpoint);
    }),
  );
});
