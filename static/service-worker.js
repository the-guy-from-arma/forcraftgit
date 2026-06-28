const CACHE = "rp-command-v33-getting-started";
const ASSETS = [
  "/",
  "/static/styles.css?v=0.0.33",
  "/static/app.js?v=0.0.33",
  "/static/icons/icon.svg",
  "/static/getting-started/used-cars.jpg",
  "/static/getting-started/dirty-pond.jpg",
  "/static/getting-started/bag-store.jpg",
  "/static/getting-started/townhall.jpg",
  "/static/getting-started/hardware-store.jpg",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) =>
          cached || (event.request.mode === "navigate" ? caches.match("/") : new Response("", { status: 503 }))
        )
      )
  );
});
