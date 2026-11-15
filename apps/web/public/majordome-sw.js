// Majordome's service worker. It only shows Web Push notifications and opens their thread when
// clicked; it handles no fetches, so pages load exactly as they would without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readMessage(data) {
  if (!data) return {};
  try {
    const value = data.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return { body: data.text() };
  }
}

const text = (value, fallback) => (typeof value === "string" && value !== "" ? value : fallback);

self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(text(message.title, "Majordome"), {
      body: text(message.body, ""),
      tag: text(message.tag, undefined),
      icon: "/icon-192x192.png",
      data: { url: text(message.url, "/feed") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(text(event.notification.data?.url, "/feed"), self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === target.origin);
      if (open) {
        await open.focus();
        const navigated = await open.navigate?.(target.href).catch(() => null);
        if (navigated !== null && navigated !== undefined) return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
