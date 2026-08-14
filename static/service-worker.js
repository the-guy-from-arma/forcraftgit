const CACHE = "faircroft-rp-v041-ravenhood-engine-v1";
const ASSETS = [
  "/",
  "/static/styles.css?v=0.4.1-ravenhood-engine-v1",
  "/static/ravenhood-mobile.css?v=0.4.1-ravenhood-engine-v1",
  "/static/insurance-v7.css?v=0.4.1-ravenhood-engine-v1",
  "/static/roadmap.css?v=0.1.1-ops4",
  "/static/app.js?v=0.4.1-ravenhood-engine-v1",
  "/static/thunderlink-eula-v1.0.txt",
  "/static/brand/platforms/windows.svg",
  "/static/brand/platforms/xbox.svg",
  "/static/brand/platforms/playstation.svg",
  "/static/brand/faircroft-emblem.webp",
  "/static/brand/faircroft-light-sweep.mp4",
  "/static/brand/icon-192.png",
  "/static/brand/icon-512.png",
  "/static/brand/apple-touch-icon.png",
  "/static/getting-started/01-used-cars.webp",
  "/static/getting-started/02-stick-route.webp",
  "/static/getting-started/02-stick-collection.webp",
  "/static/getting-started/03-bag-store.webp",
  "/static/getting-started/04-town-hall.webp",
  "/static/getting-started/05-hardware-store.webp",
  "/static/getting-started/06-mine-smeltery.webp",
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
