/**
 * Minimal service worker required for install prompt eligibility.
 * Keep runtime behavior as network-first passthrough.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if ("caches" in self) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", () => {
  // passthrough
});
