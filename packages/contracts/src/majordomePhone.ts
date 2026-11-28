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

/** A device's readable name, such as "iPhone · Safari", made from its browser at subscribe time. */
export const MajordomePushDeviceLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(60));

export const MajordomeSavePushSubscriptionInput = Schema.Struct({
  subscription: MajordomePushSubscription,
  label: Schema.optionalKey(MajordomePushDeviceLabel),
});
export type MajordomeSavePushSubscriptionInput = typeof MajordomeSavePushSubscriptionInput.Type;

export const MajordomePushEndpointInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
});
export type MajordomePushEndpointInput = typeof MajordomePushEndpointInput.Type;

const PhonePushToken = TrimmedNonEmptyString.check(Schema.isMaxLength(1024));

/**
 * A phone app's own notification address: Apple's device token with the app it was given to and
 * which of Apple's two services knows it, or Google's registration token.
 */
export const MajordomePhonePushDevice = Schema.Union([
  Schema.Struct({
    platform: Schema.Literal("ios"),
    token: PhonePushToken,
    bundleId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    apnsEnvironment: Schema.Literals(["production", "sandbox"]),
    label: Schema.optionalKey(MajordomePushDeviceLabel),
  }),
  Schema.Struct({
    platform: Schema.Literal("android"),
    token: PhonePushToken,
    label: Schema.optionalKey(MajordomePushDeviceLabel),
  }),
]);
export type MajordomePhonePushDevice = typeof MajordomePhonePushDevice.Type;

export const MajordomePhonePushRegistration = Schema.Struct({
  /** Names the phone in the list of devices, and when removing or testing it. Never the token. */
  endpoint: Schema.String,
  /** False while this server has no way to reach Apple's or Google's service for this phone. */
  canSend: Schema.Boolean,
});
export type MajordomePhonePushRegistration = typeof MajordomePhonePushRegistration.Type;

/** A device that gets notifications. Devices saved before labels existed have neither field. */
export const MajordomePushDevice = Schema.Struct({
  endpoint: Schema.String,
  label: Schema.NullOr(Schema.String),
  /** ISO time the device turned notifications on. */
  addedAt: Schema.NullOr(Schema.String),
  /** The access the device had when it turned notifications on; older servers do not say. */
  sessionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type MajordomePushDevice = typeof MajordomePushDevice.Type;

export const MajordomePushDevices = Schema.Struct({
  devices: Schema.Array(MajordomePushDevice),
});
export type MajordomePushDevices = typeof MajordomePushDevices.Type;

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

/**
 * The public `*.majord.link` address, which a phone reaches with nothing installed: off, asked for
 * and still connecting, answering, or not possible on this computer (`reason` says why).
 */
export const MajordomeAnywhereState = Schema.Literals(["off", "starting", "ready", "unavailable"]);
export type MajordomeAnywhereState = typeof MajordomeAnywhereState.Type;

export const MajordomeAnywhere = Schema.Struct({
  state: MajordomeAnywhereState,
  /** The public HTTPS address, once the address service has given one. */
  url: Schema.NullOr(Schema.String),
  /** A sentence for the owner when `unavailable`, or when the connection keeps failing. */
  reason: Schema.NullOr(Schema.String),
});
export type MajordomeAnywhere = typeof MajordomeAnywhere.Type;

export const MajordomePhoneSetup = Schema.Struct({
  anywhere: MajordomeAnywhere,
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
