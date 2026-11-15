import type { MajordomePushSubscription } from "@t3tools/contracts";

import {
  base64UrlToBytes,
  deviceLabel,
  devicePushSupport,
  isAppleMobileDevice,
  isOnPhone,
  subscriptionUsesKey,
} from "./phone.logic";

/** Served from `public/` at the root, so its scope covers every page of the app. */
const SERVICE_WORKER_URL = "/majordome-sw.js";

/** True when Majordome runs as an installed app, opened from the Home Screen or dock. */
function readIsStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

export function readDevicePushSupport() {
  return devicePushSupport({
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    isAppleMobile: isAppleMobileDevice(navigator.userAgent, navigator.maxTouchPoints),
    isStandalone: readIsStandalone(),
  });
}

export function readIsOnPhone(): boolean {
  return isOnPhone({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    isStandalone: readIsStandalone(),
    isSecureContext: window.isSecureContext,
  });
}

export function readDeviceLabel(): string | undefined {
  return deviceLabel(navigator.userAgent, navigator.maxTouchPoints);
}

/** This device's current subscription, if it has one. Never asks for permission. */
export async function readDeviceSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission (call it from a click), then subscribes with this server's key. */
export async function subscribeDevice(publicKey: string): Promise<MajordomePushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this app. Allow them in your browser or phone settings."
        : "Notifications were not allowed.",
    );
  }
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing !== null && !subscriptionUsesKey(existing.options.applicationServerKey, publicKey)) {
    await existing.unsubscribe();
  }
  const subscription =
    existing !== null && subscriptionUsesKey(existing.options.applicationServerKey, publicKey)
      ? existing
      : await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(publicKey),
        });
  const json = subscription.toJSON();
  if (json.endpoint === undefined || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("This browser did not give a usable notification address.");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** Removes this device's subscription and returns its endpoint, so the server forgets it too. */
export async function unsubscribeDevice(): Promise<string | null> {
  const subscription = await readDeviceSubscription();
  if (subscription === null) return null;
  await subscription.unsubscribe();
  return subscription.endpoint;
}
