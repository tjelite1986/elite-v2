import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Canonical private / reserved ranges. net.BlockList does numeric matching, so
// it can't be tricked the way string-prefix checks ("10.", "192.168.") can.
const BLOCKLIST = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as const) {
  BLOCKLIST.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard-only
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  BLOCKLIST.addSubnet(addr, prefix, "ipv6");
}

function isBlockedAddress(address: string, family: number): boolean {
  return BLOCKLIST.check(address, family === 6 ? "ipv6" : "ipv4");
}

// Fetch by connecting directly to a pre-validated IP. The hostname is never
// re-resolved by the socket (host is an IP literal), which is what defeats DNS
// rebinding between validation and connect. TLS still validates against the
// real hostname via `servername`.
function fetchPinned(
  target: URL,
  ip: string,
  family: number,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  const mod = target.protocol === "https:" ? https : http;
  const port =
    target.port || (target.protocol === "https:" ? 443 : 80);
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        host: ip,
        family,
        servername: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          Host: target.hostname,
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "EliteImageProxy/1.0",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const contentType = String(res.headers["content-type"] || "");
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            req.destroy(new Error("response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status, contentType, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

// Collapse every upstream failure to one opaque response; log the real cause
// server-side only so we don't leak upstream internals to the caller.
function upstreamFailed(reason: string): NextResponse {
  console.error(`[image-proxy] ${reason}`);
  return NextResponse.json({ error: "upstream fetch failed" }, { status: 502 });
}

export async function GET(req: NextRequest) {
  // Authenticated users only — the proxy makes outbound requests on the
  // server's behalf, so it must never be reachable anonymously.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
  }

  // Resolve and reject if ANY resolved address is private/reserved.
  let resolved: { address: string; family: number }[];
  try {
    resolved = await dns.lookup(target.hostname, { all: true });
  } catch {
    return NextResponse.json({ error: "DNS resolution failed" }, { status: 400 });
  }
  if (resolved.length === 0) {
    return NextResponse.json({ error: "Host did not resolve" }, { status: 400 });
  }
  for (const { address, family } of resolved) {
    if (isBlockedAddress(address, family)) {
      return NextResponse.json(
        { error: "Refusing to proxy private or reserved address" },
        { status: 400 },
      );
    }
  }
  // Pin to the first validated address so the socket can't be rebound.
  const pinned = resolved[0];

  let result: { status: number; contentType: string; body: Buffer };
  try {
    result = await fetchPinned(target, pinned.address, pinned.family);
  } catch (err: any) {
    return upstreamFailed(err?.message || "request error");
  }

  // Don't follow redirects: a 3xx Location could point at a private host and
  // bypass validation. Reject with a generic error.
  if (result.status >= 300 && result.status < 400) {
    return upstreamFailed(`redirect (${result.status})`);
  }
  if (result.status < 200 || result.status >= 300) {
    return upstreamFailed(`status ${result.status}`);
  }
  if (!result.contentType.startsWith("image/")) {
    return upstreamFailed(`non-image content-type (${result.contentType})`);
  }

  // No Access-Control-Allow-Origin and a private cache: the screenshot client
  // fetches this route same-origin, so wildcard CORS / a shared cache would
  // only help an attacker page read a successful SSRF response.
  return new NextResponse(new Uint8Array(result.body), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.body.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
