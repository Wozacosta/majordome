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
