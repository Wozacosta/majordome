import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { MajordomePhonePushDevice, ManagedPolicyDocument } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Checks the proof the way the address service does, outside Effect.
import * as NodeCrypto from "node:crypto";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as EnvironmentKeys from "../cloud/environmentKeys.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { fakeHttp, type FakeReply, type SentRequest } from "./fakeHttp.testkit.ts";
import * as PhonePushRelay from "./PhonePushRelay.ts";

const iphone: MajordomePhonePushDevice = {
  platform: "ios",
  token: "ab".repeat(32),
  bundleId: "io.github.wozacosta.majordome.ios",
  apnsEnvironment: "sandbox",
};
const android: MajordomePhonePushDevice = { platform: "android", token: "fcm-token_0123456789" };
const message = {
  title: "Waiting for you",
  body: "Plan the week has a question.",
  tag: "majordome:thread-1",
  url: "/threads/env-1/thread-1",
};

const world = (
  reply: (sent: SentRequest) => FakeReply | Effect.Effect<FakeReply>,
  policy?: ManagedPolicyDocument,
) => {
  const secrets = new Map<string, Uint8Array>();
  const http = fakeHttp(reply);
  const layer = PhonePushRelay.layer.pipe(
    Layer.provideMerge(EnvironmentKeys.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
          create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        }),
        ManagedPolicy.layerTest(policy),
        Layer.succeed(HttpClient.HttpClient, http.client),
      ),
    ),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)),
  );
  return { layer, requests: http.requests };
};

const decodeBody = Schema.decodeUnknownSync(
  Schema.Struct({ publicKey: Schema.String, proof: Schema.String, message: Schema.String }),
);
const decodePart = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

describe("PhonePushRelay", () => {
  it.effect(
    "signs each notification for exactly its text and sends it to the address service",
    () => {
      const { layer, requests } = world(() => ({ body: { result: "sent" } }));
      return Effect.gen(function* () {
        const relay = yield* PhonePushRelay.PhonePushRelay;
        const signingKey = yield* EnvironmentKeys.EnvironmentSigningKey;

        assert.equal(yield* relay.send(iphone, message), "sent");

        assert.deepEqual(
          requests.map((sent) => sent.route),
          ["POST broker.majord.link/v1/push"],
        );
        const sent = decodeBody(requests[0]?.json);
        assert.deepEqual(JSON.parse(sent.message), {
          platform: "ios",
          token: iphone.token,
          title: message.title,
          body: message.body,
          tag: message.tag,
          deepLink: message.url,
          topic: "io.github.wozacosta.majordome.ios",
          environment: "sandbox",
        });
        const [header, payload, signature] = sent.proof.split(".");
        assert.equal(sent.publicKey, signingKey.publicKey);
        assert.deepEqual(decodePart(header), { alg: "EdDSA", typ: "majord-address+jwt" });
        assert.deepEqual(decodePart(payload), {
          aud: "majord-broker",
          act: "push",
          sha: NodeCrypto.createHash("sha256").update(sent.message).digest("hex"),
          iat: 0,
          exp: 120,
        });
        assert.isTrue(
          NodeCrypto.verify(
            null,
            Buffer.from(`${header}.${payload}`),
            sent.publicKey,
            Buffer.from(signature ?? "", "base64url"),
          ),
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "cuts a long text and cleans the tag so the service never refuses one for its shape",
    () => {
      const { layer, requests } = world(() => ({ body: { result: "sent" } }));
      return Effect.gen(function* () {
        const relay = yield* PhonePushRelay.PhonePushRelay;
        yield* relay.send(android, {
          ...message,
          body: "x".repeat(900),
          tag: `majordome:agent:${"t/".repeat(40)}`,
        });
        const payload = JSON.parse(decodeBody(requests[0]?.json).message);
        assert.lengthOf(payload.body, 400);
        assert.isTrue(payload.body.endsWith("…"));
        assert.match(payload.tag, /^[\w:.-]{1,64}$/);
        assert.notProperty(payload, "topic");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("reads the service's answers: gone, not set up, an older service, refused", () => {
    const replies: Array<FakeReply> = [
      { body: { result: "gone" } },
      { status: 503, body: { error: "push_off" } },
      { status: 404, body: { error: "invalid_request" } },
      { status: 429, body: { error: "rate_limited" } },
      { status: 502, body: { error: "upstream" } },
    ];
    const { layer } = world(() => replies.shift() ?? {});
    return Effect.gen(function* () {
      const relay = yield* PhonePushRelay.PhonePushRelay;
      const deliveries: Array<PhonePushRelay.PhonePushDelivery> = [];
      for (let index = 0; index < 5; index++) deliveries.push(yield* relay.send(android, message));
      assert.deepEqual(deliveries, ["gone", "unavailable", "unavailable", "failed", "failed"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("asks which phones can be reached at most every ten minutes", () => {
    let android = false;
    const { layer, requests } = world((sent) =>
      sent.method === "GET" ? { body: { ios: true, android } } : { body: { result: "sent" } },
    );
    return Effect.gen(function* () {
      const relay = yield* PhonePushRelay.PhonePushRelay;
      assert.deepEqual(yield* relay.availability(), { ios: true, android: false });
      android = true;
      assert.deepEqual(yield* relay.availability(), { ios: true, android: false });
      yield* TestClock.adjust("11 minutes");
      assert.deepEqual(yield* relay.availability(), { ios: true, android: true });
      assert.deepEqual(
        requests.map((sent) => sent.route),
        ["GET broker.majord.link/v1/push", "GET broker.majord.link/v1/push"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("reaches no phone when the service has no such route or cannot be reached", () => {
    const { layer } = world((sent) =>
      sent.method === "GET" ? { status: 404, body: { error: "invalid_request" } } : {},
    );
    return Effect.gen(function* () {
      const relay = yield* PhonePushRelay.PhonePushRelay;
      assert.deepEqual(yield* relay.availability(), { ios: false, android: false });
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends nothing outside when the organization keeps this computer in", () => {
    const { layer, requests } = world(() => ({ body: { ios: true, android: true } }), {
      schemaVersion: 1,
      organization: "Example",
      limits: { connect: false },
    });
    return Effect.gen(function* () {
      const relay = yield* PhonePushRelay.PhonePushRelay;
      assert.deepEqual(yield* relay.availability(), { ios: false, android: false });
      assert.equal(yield* relay.send(iphone, message), "unavailable");
      assert.lengthOf(requests, 0);
    }).pipe(Effect.provide(layer));
  });
});
