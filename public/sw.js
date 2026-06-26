/* Elite service worker.
 * - Cache-first for small image variants (thumbnails / posters / icons) so the
 *   gallery and shorts grids re-render instantly and hit the server less.
 * - Web Push: show notifications when the app/tab is closed and focus the app
 *   on click.
 * Deliberately conservative: it never intercepts video or range requests (that
 * is easy to get wrong and break playback) — those pass straight to the network.
 */
const IMG_CACHE = "elite-img-v1";
const IMG_LIMIT = 600;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);

function isCacheableImage(url) {
  return (
    (/\/api\/gallery\/\d+\/media/.test(url.pathname) &&
      /variant=(thumb|preview)/.test(url.search)) ||
    /\/api\/shorts\/\d+\/poster/.test(url.pathname) ||
    /\/icon-\d+\.png$/.test(url.pathname)
  );
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - IMG_LIMIT;
  for (let i = 0; i < overflow; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || !isCacheableImage(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) {
          cache.put(req, res.clone());
          trimCache(cache);
        }
        return res;
      } catch (err) {
        const fallback = await cache.match(req);
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});

// --- Web Push ---
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  const title = data.title || "Elite";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
