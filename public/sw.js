// MSE Field service worker — caches the app shell for offline use.
// Photo uploads use IndexedDB (see lib/upload-queue.ts) and don't go through here.

// Bump this only when sw.js LOGIC changes — bumping wipes the offline
// cache, so the next time the user goes offline the dynamic pages they
// haven't re-visited won't load. App-code changes don't need a bump;
// the stale-while-revalidate fetch handler picks up new HTML/JS
// automatically when online.
const CACHE = "mse-field-v6";
const PRECACHE = [
  "/login",
  "/jobs",
  "/offline",
  "/manifest.json",
  "/logo.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (request.mode === "navigate") {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          // Try the exact URL first.
          const cached = await cache.match(request);
          if (cached) return cached;

          // For any /jobs/* path the user hasn't visited online yet
          // (most importantly: brand new offline-created local-job-XXX
          // URLs), serve the offline shell, which reads the pathname on
          // the client and renders the right offline view from IDB.
          if (url.pathname.startsWith("/jobs/")) {
            const offlineShell = await cache.match("/offline");
            if (offlineShell) return offlineShell;
          }

          // Last resort — login is always pre-cached.
          const loginShell = await cache.match("/login");
          return (
            loginShell ||
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }
      }

      const cached = await cache.match(request);
      if (cached) {
        fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
