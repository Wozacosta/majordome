import type {
  AuthClientSession,
  EnvironmentId,
  MajordomePhoneSetup,
  MajordomePushDevice,
  MajordomeRoutinesRunner,
} from "@t3tools/contracts";

import { machineInSentence } from "./brains.logic";
import { alwaysOnCopy } from "./home.logic";

/**
 * Whether this browser can get Majordome's notifications, and if not, what the owner can do.
 * iPhone and iPad only allow Web Push for a web app added to the Home Screen, opened over HTTPS.
 */
export type DevicePushSupport = "supported" | "insecure" | "needs-home-screen" | "unsupported";

export interface DevicePushEnvironment {
  readonly isSecureContext: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasPushManager: boolean;
  readonly isAppleMobile: boolean;
  readonly isStandalone: boolean;
}

export function devicePushSupport(env: DevicePushEnvironment): DevicePushSupport {
  if (!env.isSecureContext) return "insecure";
  if (env.isAppleMobile && !env.isStandalone) return "needs-home-screen";
  return env.hasServiceWorker && env.hasPushManager ? "supported" : "unsupported";
}

/** iPadOS reports itself as a Mac; touch support tells them apart. */
export function isAppleMobileDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

function deviceKind(userAgent: string, maxTouchPoints: number): string | null {
  if (/iPhone|iPod/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return null;
}

function browserName(userAgent: string): string | null {
  if (/Edg(?:e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

/** A readable name for this device, such as "iPhone · Safari"; undefined when neither is known. */
export function deviceLabel(userAgent: string, maxTouchPoints: number): string | undefined {
  const parts = [deviceKind(userAgent, maxTouchPoints), browserName(userAgent)].filter(
    (part) => part !== null,
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** Where the notifications part of "Phone & notifications" starts; old links land on it. */
export const NOTIFICATIONS_ANCHOR = "notifications";

type TailscaleState = MajordomePhoneSetup["tailscale"];

// Each state means every step before it is done.
const TAILSCALE_PROGRESS: Record<TailscaleState, number> = {
  "not-installed": 0,
  "signed-out": 0,
  "https-off": 1,
  "not-served": 2,
  ready: 3,
};

/** The computer's side of phone setup, from what Tailscale reports. */
export function computerSetupProgress(tailscale: TailscaleState): {
  readonly tailscaleOn: boolean;
  readonly secureAddressesOn: boolean;
  readonly majordomeReachable: boolean;
} {
  const done = TAILSCALE_PROGRESS[tailscale];
  return { tailscaleOn: done >= 1, secureAddressesOn: done >= 2, majordomeReachable: done >= 3 };
}

type Anywhere = MajordomePhoneSetup["anywhere"];

/**
 * The "from anywhere" address to show. A command's answer is newer than the setup read before it,
 * so it stands in while that setup is read again.
 */
export function currentAnywhere(
  read: Anywhere,
  answered: Anywhere | null,
  rereading: boolean,
): Anywhere {
  return rereading && answered !== null ? answered : read;
}

/** What the "from anywhere" part shows; `address` is what a phone's code is made for. */
type AnywhereView =
  | { readonly kind: "offer" }
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly address: string }
  | { readonly kind: "unavailable"; readonly reason: string | null };

export function anywhereView(anywhere: Anywhere, enabling: boolean): AnywhereView {
  if (enabling || anywhere.state === "starting") return { kind: "starting" };
  if (anywhere.state === "unavailable") return { kind: "unavailable", reason: anywhere.reason };
  if (anywhere.state === "off") return { kind: "offer" };
  // Ready without an address cannot be scanned yet.
  return anywhere.url === null ? { kind: "starting" } : { kind: "ready", address: anywhere.url };
}

/**
 * How the two ways to reach this computer share the page. The address from anywhere always leads;
 * Tailscale's steps open by themselves only when that address can't be had.
 */
export function phoneWays(setup: Pick<MajordomePhoneSetup, "anywhere" | "tailscale">): {
  readonly tailscaleOpen: boolean;
  /** A phone may already be set up through Tailscale, and the address from anywhere is off. */
  readonly tailscaleOnly: boolean;
  /** Both work, so a phone stays on the one it was set up with. */
  readonly bothInUse: boolean;
} {
  const tailscaleReady = setup.tailscale === "ready";
  const anywhere = setup.anywhere.state;
  return {
    tailscaleOpen: anywhere === "unavailable",
    tailscaleOnly: tailscaleReady && anywhere === "off",
    bothInUse: tailscaleReady && anywhere !== "off" && anywhere !== "unavailable",
  };
}

/** The address a phone uses away from home: the one from anywhere first, then Tailscale's. */
export function phoneAddress(
  setup: Pick<MajordomePhoneSetup, "anywhere" | "tailscale" | "secureUrl">,
): { readonly way: "anywhere" | "tailscale"; readonly url: string | null } | null {
  if (setup.anywhere.state === "ready") return { way: "anywhere", url: setup.anywhere.url };
  return setup.tailscale === "ready" ? { way: "tailscale", url: setup.secureUrl } : null;
}

/**
 * The computer a phone is set up on: the always-on one (`alwaysOnCopy`) when there is one, with
 * several the first notes folder's; else this window's own.
 */
export function phoneEnvironmentId(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connected: ReadonlyArray<EnvironmentId>;
  /** Each computer's copy of each notes folder, in the order the folders are listed. */
  readonly copies: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly routinesRunner: MajordomeRoutinesRunner | null;
  }>;
}): EnvironmentId | null {
  if (input.primaryEnvironmentId === null) return null;
  return alwaysOnCopy(input)?.environmentId ?? input.primaryEnvironmentId;
}

/** How phone setup names the phone's computer: `name` is null when it is this one. */
export function phoneComputerWords(name: string | null): {
  readonly inSentence: string;
  readonly atStart: string;
} {
  if (name === null) return { inSentence: "this computer", atStart: "This computer" };
  const inSentence = machineInSentence(name).replace(/^Another /, "another ");
  // "Your server", "Your Majordome server": a name Majordome gave reads as a description.
  const described = inSentence.startsWith("your ");
  return {
    inSentence,
    atStart: described ? `Y${inSentence.slice(1)}` : name,
  };
}

/** The first phone or tablet that gets notifications, by the name it registered with. */
export function phoneWithNotifications(
  devices: ReadonlyArray<Pick<MajordomePushDevice, "label">>,
): string | null {
  return (
    devices.find((device) => /^(iPhone|iPad|Android)\b/.test(device.label ?? ""))?.label ?? null
  );
}

/** What a phone's code is labelled with; the phone's access keeps the label. */
export const PHONE_PAIRING_LABEL = "Phone";

/**
 * The link that opens Majordome's phone app on its add-a-computer screen with `pairingUrl` filled
 * in. The scheme is the one the released app registers (`apps/mobile/majordome/identity.ts`).
 */
export const phoneAppPairingLink = (pairingUrl: string) =>
  `majordome://connections/new?${new URLSearchParams([["pairingUrl", pairingUrl]])}`;

export interface PairedPhone {
  readonly sessionId: AuthClientSession["sessionId"];
  readonly name: string;
  readonly connected: boolean;
}

/**
 * The phones and tablets that can open Majordome on a computer: those added with a code from
 * "Phone & notifications", and any other handheld. The device asking is never one of them.
 */
export function pairedPhones(
  sessions: ReadonlyArray<
    Pick<AuthClientSession, "sessionId" | "client" | "connected" | "current">
  >,
): ReadonlyArray<PairedPhone> {
  return sessions
    .filter(
      ({ client, current }) =>
        !current &&
        (client.label === PHONE_PAIRING_LABEL ||
          client.deviceType === "mobile" ||
          client.deviceType === "tablet"),
    )
    .map(({ sessionId, client, connected }) => ({
      sessionId,
      name: [client.os, client.browser].filter(Boolean).join(" · ") || "A phone",
      connected,
    }));
}

/** `unseen` is a step done on the phone that nothing tells this computer about. */
export type PhoneStepState = "done" | "todo" | "unseen";

/**
 * How far a phone is, each step on its own evidence. `paired` is how many phones can open
 * Majordome, null when this device may not see that; `notified` is `phoneWithNotifications`.
 */
export function phoneStepStates(input: {
  readonly paired: number | null;
  readonly notified: string | null;
}): {
  readonly open: PhoneStepState;
  readonly homeScreen: PhoneStepState;
  readonly notifications: PhoneStepState;
} {
  const notified = input.notified !== null;
  return {
    // Notifications are turned on from inside Majordome, so the phone has opened it.
    open: notified || (input.paired ?? 0) > 0 ? "done" : "todo",
    // iPhone and iPad only allow notifications from the Home Screen app.
    homeScreen: /^(iPhone|iPad)\b/.test(input.notified ?? "") ? "done" : "unseen",
    notifications: notified ? "done" : "todo",
  };
}

/** Why "Notifications on this device" can't be turned on, when it can't. */
export type NotificationsProblem = "read-only" | "unreachable" | "blocked";

export function notificationsProblem(input: {
  readonly canSave: boolean;
  /** Whether Majordome's notification key was read: without it nothing can subscribe. */
  readonly key: "loading" | "ready" | "failed";
  readonly permission: NotificationPermission;
  readonly on: boolean;
}): NotificationsProblem | null {
  if (input.on) return null;
  if (!input.canSave) return "read-only";
  if (input.permission === "denied") return "blocked";
  return input.key === "failed" ? "unreachable" : null;
}

/** Where a blocked device allows notifications again, in that device's own words. */
export function blockedNotificationsHelp(userAgent: string, maxTouchPoints: number): string {
  const kind = deviceKind(userAgent, maxTouchPoints);
  if (kind === "iPhone" || kind === "iPad") {
    return `Notifications are blocked for Majordome on this ${kind}. Open the Settings app, tap Notifications, then Majordome, and turn on Allow Notifications. Then come back and turn this on.`;
  }
  if (kind === "Android") {
    return "Notifications are blocked for Majordome on this phone. Press and hold the Majordome icon, tap App info, then Notifications, and allow them. Then come back and turn this on.";
  }
  return "Notifications are blocked for Majordome in this browser. Click the icon to the left of the address at the top of the window, allow Notifications, then reload this page.";
}

/**
 * Whether "Phone & notifications" is open on the phone itself: a phone or tablet running the installed app,
 * or on an HTTPS address, which a phone only reaches once set up (Wi-Fi pairing is plain HTTP).
 */
export function isOnPhone(input: {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  readonly isStandalone: boolean;
  readonly isSecureContext: boolean;
}): boolean {
  const kind = deviceKind(input.userAgent, input.maxTouchPoints);
  const handheld = kind === "iPhone" || kind === "iPad" || kind === "Android";
  return handheld && (input.isStandalone || input.isSecureContext);
}

/** The bytes of a base64url VAPID key, as `pushManager.subscribe` wants them. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** True when a subscription was made with another server's key and must be replaced. */
export function subscriptionUsesKey(
  applicationServerKey: ArrayBuffer | null,
  publicKey: string,
): boolean {
  if (applicationServerKey === null) return false;
  const expected = base64UrlToBytes(publicKey);
  const actual = new Uint8Array(applicationServerKey);
  return (
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  );
}

/** The sidebar shortcut to phone setup, shown on a computer only. */
export const PHONE_SHORTCUT_LABEL = "Use on your phone";
