// Network-first service worker for the shared kiosk (scope: /kiosk).
// Separate cache name + scope from timesheet_kiosk's /timesheet-sw.js, so the
// two apps never interfere with each other on the same site.
const CACHE = "shared-timesheet-kiosk-v1";
const SHELL = [
  "/kiosk",
  "/assets/shared_timesheet/css/shared-kiosk.css",
  "/assets/shared_timesheet/js/shared-kiosk-api.js",
  "/assets/shared_timesheet/js/shared-kiosk-app.js",
  "/assets/shared_timesheet/shared-kiosk-manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("shared-timesheet-kiosk") && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;          // never touch API POSTs
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;    // never cache API/GETs either
  if (url.pathname.startsWith("/private/")) return; // never cache photos
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
