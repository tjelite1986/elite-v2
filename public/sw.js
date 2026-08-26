/* Elite service worker.
 * - Cache-first for small image variants (thumbnails / posters / icons) so the
 *   gallery and shorts grids re-render instantly and hit the server less.
 * - Web Push: show notifications when the app/tab is closed and focus the app
 *   on click.
 * Deliberately conservative: it never intercepts video or range requests (that
 * is easy to get wrong and break playback) — those pass straight to the network.
 */
// Bump the version to drop the previous cache: the old worker was cache-first
// and could pin a stale poster/thumbnail under a constant URL. Purging on
// activate self-heals every device once.
const IMG_CACHE = "elite-img-v3";
const IMG_LIMIT = 600;
// Music the user explicitly downloaded for offline playback. Written by the
// page (lib/music-offline.ts), only read here — so this worker never evicts it.
const MUSIC_CACHE = "elite-music-offline-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== IMG_CACHE && name !== MUSIC_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  )
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

function isDownloadedMusic(url) {
  return /^\/api\/music\/(stream|cover)\//.test(url.pathname);
}

/**
 * Serve a downloaded track from the cache, answering a Range request out of the
 * stored bytes. The cached entry is always a full 200 response (Cache.put
 * rejects a 206), so the 206 an <audio> element needs for seeking has to be
 * assembled here.
 */
async function serveFromMusicCache(req) {
  const cache = await caches.open(MUSIC_CACHE);
  // Ignore the request's Vary/headers — the entry was stored by a plain fetch.
  const hit = await cache.match(req, { ignoreVary: true });
  if (!hit) return null;

  const range = req.headers.get("range");
  if (!range) return hit;

  const buffer = await hit.arrayBuffer();
  const total = buffer.byteLength;
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return new Response(buffer, { status: 200, headers: hit.headers });

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start > end) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${total}` },
    });
  }

  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": hit.headers.get("content-type") || "audio/mpeg",
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${total}`,
      "accept-ranges": "bytes",
    },
  });
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
  if (url.origin !== self.location.origin) return;
  // Same origin, different app: /store is routed to the store's own server.
  // Nothing under it is ours to cache or serve from a cache of ours.
  if (url.pathname === "/store" || url.pathname.startsWith("/store/")) return;

  // Downloaded music wins over the network: that is the whole point of having
  // downloaded it, and it keeps playback going when the Pi is unreachable.
  if (isDownloadedMusic(url)) {
    event.respondWith(
      (async () => {
        const cached = await serveFromMusicCache(req).catch(() => null);
        if (cached) return cached;
        return fetch(req);
      })()
    );
    return;
  }

  if (!isCacheableImage(url)) return;

  // Stale-while-revalidate: serve the cached copy instantly (fast grids) but
  // always refetch in the background and update the cache, so a replaced cover
  // frame shows up on the next view even when the URL is unchanged. The server
  // sends no-cache + ETag, so an unchanged poster revalidates as a cheap 304.
  event.respondWith(
    (async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      const revalidate = fetch(req)
        .then((res) => {
          if (res.ok && res.status === 200) {
            cache.put(req, res.clone());
            trimCache(cache);
          }
          return res;
        })
        .catch(() => null);
      if (hit) {
        event.waitUntil(revalidate);
        return hit;
      }
      const res = await revalidate;
      if (res) return res;
      return new Response("", { status: 504 });
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
