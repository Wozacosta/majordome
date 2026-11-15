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

/**
 * Whether "Your phone" is open on the phone itself: a phone or tablet running the installed app,
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
