import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

// SSRF-safe Open Graph link-preview fetcher. Mirrors the IP-pinning approach of
// the image proxy, but follows a few redirects (re-validating each hop) since
// links commonly redirect http→https or apex→www. Results are cached in memory.

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024; // enough to cover <head>
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A failed/empty fetch is cached only briefly so a transient error doesn't hide
// a link's preview for the full TTL.
const NULL_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const BLOCKLIST = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKLIST.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  // NOTE: do NOT add ::ffff:0:0/96 here — net.BlockList matches IPv4 addresses
  // against IPv4-mapped IPv6 subnets, so that range blocks EVERY IPv4 address.
  // IPv4 is covered by the ipv4 ranges above; dns.lookup never returns mapped
  // forms.
  ["64:ff9b::", 96],
  ["100::", 64],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKLIST.addSubnet(addr, prefix, "ipv6");
}

// IPv4-mapped IPv6 range, checked ONLY against family-6 addresses. We can't add
// it to BLOCKLIST (net.BlockList would then reject every real IPv4), but a
// literal like [::ffff:10.0.0.1] resolves as family-6 and must be rejected so it
// can't smuggle a private IPv4 past the guard.
const MAPPED_V4 = new net.BlockList();
MAPPED_V4.addSubnet("::ffff:0:0", 96, "ipv6");

function isBlockedAddress(address: string, family: number): boolean {
  if (family === 6) {
    return (
      BLOCKLIST.check(address, "ipv6") || MAPPED_V4.check(address, "ipv6")
    );
  }
  return BLOCKLIST.check(address, "ipv4");
}

const cache = new Map<string, { at: number; data: LinkPreview | null }>();

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  // Tolerant of attribute order (property/name before or after content).
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decode(m[1]);
  }
  return null;
}

function parseMeta(html: string, baseUrl: string): LinkPreview {
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  let image =
    metaContent(html, "og:image") || metaContent(html, "twitter:image");
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = null;
    }
  }
  return {
    url: baseUrl,
    title:
      metaContent(html, "og:title") ||
      (titleTag ? decode(titleTag[1]) : null),
    description:
      metaContent(html, "og:description") ||
      metaContent(html, "description") ||
      metaContent(html, "twitter:description"),
    image,
    siteName: metaContent(html, "og:site_name"),
  };
}

function fetchOnce(
  target: URL
): Promise<{ status: number; location: string | null; contentType: string; body: Buffer }> {
  return new Promise(async (resolve, reject) => {
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return reject(new Error("bad protocol"));
    }
    let resolved: { address: string; family: number }[];
    try {
      resolved = await dns.lookup(target.hostname, { all: true });
    } catch {
      return reject(new Error("dns"));
    }
    if (resolved.length === 0) return reject(new Error("no address"));
    for (const { address, family } of resolved) {
      if (isBlockedAddress(address, family)) {
        return reject(new Error("blocked address"));
      }
    }
    const pinned = resolved[0];
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        host: pinned.address,
        family: pinned.family,
        servername: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          Host: target.hostname,
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (compatible; EliteLinkPreview/1.0; +https://elitev2.mecloud.win)",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location
          ? String(res.headers.location)
          : null;
        const contentType = String(res.headers["content-type"] || "");
        // Don't download non-HTML bodies (e.g. a redirect target image).
        if (status >= 200 && status < 300 && !/text\/html/i.test(contentType)) {
          res.destroy();
          return resolve({ status, location, contentType, body: Buffer.alloc(0) });
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            req.destroy();
            res.destroy();
            resolve({
              status,
              location,
              contentType,
              body: Buffer.concat(chunks),
            });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status, location, contentType, body: Buffer.concat(chunks) })
        );
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function getLinkPreview(raw: string): Promise<LinkPreview | null> {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  const key = target.toString();
  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.data ? CACHE_TTL_MS : NULL_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.data;
  }

  let data: LinkPreview | null = null;
  try {
    let current = target;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const res = await fetchOnce(current);
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, current); // re-validated next loop
        continue;
      }
      if (res.status >= 200 && res.status < 300 && res.body.length > 0) {
        const meta = parseMeta(res.body.toString("utf8"), current.toString());
        // Only count it as a preview if there's something to show.
        if (meta.title || meta.description || meta.image) data = meta;
      }
      break;
    }
  } catch {
    data = null;
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}
