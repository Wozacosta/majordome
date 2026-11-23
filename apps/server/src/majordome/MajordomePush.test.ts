import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import WebPush from "web-push";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as MajordomePush from "./MajordomePush.ts";

interface SentPush {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: number;
}

/** A push service that answers each endpoint with the status the test chose. */
const pushService = (sent: Array<SentPush>, statusFor: (url: string) => number) =>
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
});
