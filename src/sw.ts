const worker = self as unknown as ServiceWorkerGlobalScope;
// The build replaces this token with a hash of all application assets.
// Cache Storage is shared by every app on an origin; isolate this install's scope.
const CACHE_PREFIX = `still-pwa-${encodeURIComponent(worker.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_VERSION__`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./audio.js",
  "./dom.js",
  "./notify.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];
worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  // Let updates wait until existing app windows close, preserving active timers.
});
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          await caches.delete(key);
      }
      await worker.clients.claim();
    })(),
  );
});
worker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== worker.location.origin ||
    !url.href.startsWith(worker.registration.scope)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw error;
      }
    })(),
  );
});
worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await worker.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        // Other apps can share this origin; only reach for one of ours.
        if (client.url.startsWith(worker.registration.scope)) {
          await client.focus();
          return;
        }
      }
      await worker.clients.openWindow(worker.registration.scope);
    })(),
  );
});
