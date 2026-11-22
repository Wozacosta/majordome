import type {
  EnvironmentId,
  MajordomePhoneSetup,
  MajordomePushDevice,
  MajordomeRoutinesRunner,
} from "@t3tools/contracts";

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
 * The computer a phone is set up on. One that runs routines and is not this window's own is
 * always on, so it wins when it is connected; with several, the first notes folder's.
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
  const runner = input.copies.find(
    (copy) =>
      copy.routinesRunner === "this-server" &&
      copy.environmentId !== input.primaryEnvironmentId &&
      input.connected.includes(copy.environmentId),
  );
  return runner?.environmentId ?? input.primaryEnvironmentId;
}

/** How phone setup names the phone's computer: `name` is null when it is this one. */
export function phoneComputerWords(name: string | null): {
  readonly inSentence: string;
  readonly atStart: string;
} {
  if (name === null) return { inSentence: "this computer", atStart: "This computer" };
  // "Another computer" is the name of a computer saved without one.
  return { inSentence: name.replace(/^Another /, "another "), atStart: name };
}

/** The first phone or tablet that gets notifications, by the name it registered with. */
export function phoneWithNotifications(
  devices: ReadonlyArray<Pick<MajordomePushDevice, "label">>,
): string | null {
  return (
    devices.find((device) => /^(iPhone|iPad|Android)\b/.test(device.label ?? ""))?.label ?? null
  );
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
