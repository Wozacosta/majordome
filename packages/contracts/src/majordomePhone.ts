import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A browser's Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export const MajordomePushSubscription = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
  keys: Schema.Struct({
    p256dh: TrimmedNonEmptyString,
    auth: TrimmedNonEmptyString,
  }),
});
export type MajordomePushSubscription = typeof MajordomePushSubscription.Type;

export const MajordomePushConfig = Schema.Struct({
  /** This server's VAPID public key, base64url, for `pushManager.subscribe`. */
  publicKey: Schema.String,
});
export type MajordomePushConfig = typeof MajordomePushConfig.Type;

export const MajordomeSavePushSubscriptionInput = Schema.Struct({
  subscription: MajordomePushSubscription,
});
export type MajordomeSavePushSubscriptionInput = typeof MajordomeSavePushSubscriptionInput.Type;

export const MajordomePushEndpointInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
});
export type MajordomePushEndpointInput = typeof MajordomePushEndpointInput.Type;

/**
 * How far this computer is from a phone: Tailscale missing, signed out, HTTPS off on the tailnet,
 * Tailscale ready but this server not on its secure address yet, or reachable over HTTPS.
 */
export const MajordomeTailscaleState = Schema.Literals([
  "not-installed",
  "signed-out",
  "https-off",
  "not-served",
  "ready",
]);
export type MajordomeTailscaleState = typeof MajordomeTailscaleState.Type;

export const MajordomePhoneSetup = Schema.Struct({
  tailscale: MajordomeTailscaleState,
  /** The tailnet HTTPS address, once Tailscale knows this computer's name. */
  secureUrl: Schema.NullOr(Schema.String),
  /** Plain HTTP addresses on the local network; pairing works there, notifications don't. */
  wifiUrls: Schema.Array(Schema.String),
});
export type MajordomePhoneSetup = typeof MajordomePhoneSetup.Type;

export class MajordomePhoneError extends Schema.TaggedError<MajordomePhoneError>()(
  "MajordomePhoneError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
