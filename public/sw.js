/* WiFi Billing service worker — precache shell + runtime caching. */
const VERSION = "wb-v2";
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/offline",
  "/login",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/sqljs/sql-wasm.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add each precache URL individually so one failure doesn't break install.
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to cache, then /offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached =
            (await caches.match(req)) ||
            (await caches.match(url.pathname)) ||
            (await caches.match("/"));
          return cached ?? (await caches.match("/offline")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first (hashed _next chunks, icons, WASM).
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/sqljs/") ||
    url.pathname === "/manifest.webmanifest";

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cached = (await caches.match(req)) ?? (await caches.match(url.pathname));
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Other same-origin GETs (e.g. RSC payloads): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req)
        .then((res) => {
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })(),
  );
});
