/**
 * Notifications for the phone apps. A public app's sending keys are its publisher's, so this server
 * cannot hold them: it signs each notification with its own key and the address service passes it
 * on to Apple or Google. The title and the line go through that service; it keeps neither.
 */

import type { MajordomePhonePushDevice } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A one-way hash of the text the proof signs, as the address service computes it.
import * as NodeCrypto from "node:crypto";

import * as EnvironmentKeys from "../cloud/environmentKeys.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import {
  addressServiceUrl,
  PROOF_AUDIENCE,
  PROOF_LIFETIME_SECONDS,
  PROOF_TYP,
} from "./AnywhereAddress.ts";
import type { VaultPushMessage } from "./pushDecision.ts";

const REQUEST_TIMEOUT = Duration.seconds(20);
const AVAILABILITY_FRESH_MS = 10 * 60 * 1000;
// What the address service accepts; longer texts are cut here so one is never refused for length.
const TITLE_MAX = 120;
const BODY_MAX = 400;
const TAG_MAX = 64;

/** Which kinds of phone the address service can reach now. */
export interface PhonePushAvailability {
  readonly ios: boolean;
  readonly android: boolean;
}

/**
 * `gone`: Apple or Google will never deliver to that phone again. `unavailable`: there is no way
 * to reach that kind of phone from here. `failed`: this one was not delivered.
 */
export type PhonePushDelivery = "sent" | "gone" | "unavailable" | "failed";

const decodeAvailability = Schema.decodeUnknownOption(
  Schema.Struct({ ios: Schema.Boolean, android: Schema.Boolean }),
);
const decodeSent = Schema.decodeUnknownOption(
  Schema.Struct({ result: Schema.Literals(["sent", "gone"]) }),
);
const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The notification as the address service takes it: JSON text, which the proof then signs. */
function phonePushText(device: MajordomePhonePushDevice, message: VaultPushMessage): string {
  return JSON.stringify({
    platform: device.platform,
    token: device.token,
    title: clip(message.title, TITLE_MAX),
    body: clip(message.body, BODY_MAX),
    tag: message.tag.replaceAll(/[^\w:.-]/gu, "-").slice(0, TAG_MAX),
    deepLink: message.url,
    ...(device.platform === "ios"
      ? { topic: device.bundleId, environment: device.apnsEnvironment }
      : {}),
  });
}

export class PhonePushRelay extends Context.Service<
  PhonePushRelay,
  {
    /** Asked of the address service at most every ten minutes; nothing is reachable when it is not. */
    readonly availability: () => Effect.Effect<PhonePushAvailability>;
    readonly send: (
      device: MajordomePhonePushDevice,
      message: VaultPushMessage,
    ) => Effect.Effect<PhonePushDelivery>;
  }
>()("t3/majordome/PhonePushRelay") {}

const NOTHING: PhonePushAvailability = { ios: false, android: false };

const make = Effect.gen(function* () {
  const signingKey = yield* EnvironmentKeys.EnvironmentSigningKey;
  const http = yield* HttpClient.HttpClient;
  const serviceUrl = yield* addressServiceUrl;
  // An organization that keeps this computer off outside services keeps its notifications in too.
  const allowed = ManagedLimits.allowsConnect(yield* ManagedPolicy.ManagedPolicy);
  const known = yield* Ref.make<{
    readonly value: PhonePushAvailability;
    readonly at: number;
  } | null>(null);

  const ask = HttpClientRequest.get(`${serviceUrl}/v1/push`).pipe(
    HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
    http.execute,
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.flatMap((response) =>
      response.status === 200 ? response.json : Effect.succeed<unknown>(null),
    ),
    Effect.map((json) => Option.getOrElse(decodeAvailability(json), () => NOTHING)),
    // Unreachable, or a service from before it passed notifications on.
    Effect.orElseSucceed(() => NOTHING),
  );

  const availability = Effect.fn("PhonePushRelay.availability")(function* () {
    if (!allowed) return NOTHING;
    const now = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(known);
    if (cached !== null && now - cached.at < AVAILABILITY_FRESH_MS) return cached.value;
    const value = yield* ask;
    yield* Ref.set(known, { value, at: now });
    return value;
  });

  const send: PhonePushRelay["Service"]["send"] = Effect.fn("PhonePushRelay.send")(
    function* (device, message) {
      if (!allowed) return "unavailable" as const;
      const text = phonePushText(device, message);
      const issuedAt = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
      const proof = yield* signingKey.sign({
        typ: PROOF_TYP,
        payload: {
          aud: PROOF_AUDIENCE,
          act: "push",
          sha: NodeCrypto.createHash("sha256").update(text).digest("hex"),
          iat: issuedAt,
          exp: issuedAt + PROOF_LIFETIME_SECONDS,
        },
      });
      const response = yield* HttpClientRequest.post(`${serviceUrl}/v1/push`).pipe(
        HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
        HttpClientRequest.bodyJsonUnsafe({ publicKey: signingKey.publicKey, proof, message: text }),
        http.execute,
        Effect.timeout(REQUEST_TIMEOUT),
      );
      const json: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => null));
      if (response.status === 200) {
        return Option.match(decodeSent(json), {
          onNone: () => "failed" as const,
          onSome: ({ result }) => result,
        });
      }
      const code = Option.getOrUndefined(decodeErrorBody(json))?.error;
      // 404 is a service from before it passed notifications on.
      if (code === "push_off" || response.status === 404) {
        yield* Ref.set(known, null);
        return "unavailable" as const;
      }
      // The status and the service's own word only: the request holds the phone's token and the text.
      yield* Effect.logWarning("The address service did not pass a notification on.", {
        status: response.status,
        code: code ?? "unknown",
      });
      return "failed" as const;
    },
    // No `cause` in the log: it could carry the request.
    Effect.catch((cause) =>
      Effect.logWarning("Could not reach the address service for a notification.", {
        reason: cause._tag,
      }).pipe(Effect.as<PhonePushDelivery>("failed")),
    ),
  );

  return PhonePushRelay.of({ availability, send });
});

export const layer = Layer.effect(PhonePushRelay, make);
