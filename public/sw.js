/* HALO 3EL Autotrader service worker */
// v4: /_next/static/ switched from cache-first to STALE-WHILE-REVALIDATE.
// Production chunk names are content-hashed so cache-first was safe there,
// but dev (Turbopack) rewrites chunk files IN PLACE under stable names —
// cache-first pinned stale code forever. SWR serves the cached copy
// instantly, refreshes it in the background, and never goes stale past
// one load. v4 purge also flushes every v3-poisoned entry.
const CACHE = "halo3el-v4";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── web push (HALO 3EL alerts) ─────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "HALO 3EL", body: "New trading alert" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "halo3el-alert",
      renotify: true,
      data: { url: "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live data
  if (url.pathname === "/_next/webpack-hmr") return; // dev HMR

  // stale-while-revalidate for hashed/dev static assets and icons:
  // instant cache hit, background refetch keeps it honest. Turbopack dev
  // chunks share stable URLs across recompiles — SWR is what keeps dev
  // and installed PWAs from serving stale code after a deploy.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE);
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              c.put(req, copy).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        event.waitUntil(net.then(() => undefined));
        if (hit) return hit;
        const fresh = await net;
        return fresh || new Response("", { status: 504 });
      })()
    );
    return;
  }

  // network-first for navigations & everything else, fall back to cache
  // (bounded wait: prefer fresh, but never hang the shell on a stalled server)
  event.respondWith(
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), req.mode === "navigate" ? 3500 : 8000);
      fetch(req)
        .then((res) => {
          clearTimeout(t);
          if (req.mode === "navigate") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          }
          resolve(res);
        })
        .catch(() => {
          clearTimeout(t);
          caches
            .match(req)
            .then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))
            .then(resolve);
        });
    })
  );
});
