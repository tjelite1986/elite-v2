import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../appstore-storage";
import { safeHttpUrl } from "../url";

const execFileAsync = promisify(execFile);

// Shared curl-impersonate access for Cloudflare-gated mod-apk sites. Plain
// fetch() is 403'd; the static curl-impersonate binary (mounted into the
// container) presents a real Chrome TLS/JA3 fingerprint and passes the gate.

const CURL_BIN =
  process.env.CURL_IMPERSONATE_BIN || "/opt/curl-impersonate/curl-impersonate";

// Chrome-100 impersonation flags (from the curl_chrome100 wrapper).
const IMPERSONATE_ARGS = [
  "--ciphers",
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA",
  "-H", 'sec-ch-ua: " Not A;Brand";v="99", "Chromium";v="100", "Google Chrome";v="100"',
  "-H", "sec-ch-ua-mobile: ?0",
  "-H", 'sec-ch-ua-platform: "Windows"',
  "-H", "Upgrade-Insecure-Requests: 1",
  "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36",
  "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "-H", "Sec-Fetch-Site: none",
  "-H", "Sec-Fetch-Mode: navigate",
  "-H", "Sec-Fetch-User: ?1",
  "-H", "Sec-Fetch-Dest: document",
  "-H", "Accept-Language: en-US,en;q=0.9",
  "--split-cookies",
  "--http2",
  "--http2-settings", "1:65536;3:1000;4:6291456;6:262144",
  "--http2-window-update", "15663105",
  "--http2-stream-weight", "256",
  "--http2-stream-exclusive", "1",
  "--compressed",
  "--tlsv1.2",
  "--alps",
  "--cert-compression", "brotli",
  "--tls-grease",
  "--tls-signed-cert-timestamps",
];

export async function impersonateFetch(url: string): Promise<string> {
  // Reject non-http(s) URLs, and pass "--" so curl can never read a scraped URL
  // that starts with "-" as a flag (argument injection).
  const safe = safeHttpUrl(url);
  if (!safe) throw new Error("Refusing to fetch non-http(s) URL");
  try {
    const { stdout } = await execFileAsync(
      CURL_BIN,
      [...IMPERSONATE_ARGS, "-sL", "--max-time", "30", "--", safe],
      { maxBuffer: 16 * 1024 * 1024, timeout: 35000, encoding: "utf8" }
    );
    return stdout;
  } catch (err) {
    throw new Error(`Could not fetch page (${(err as Error).message.slice(0, 80)})`);
  }
}

// Some sites (e.g. apkpure.com) 403 the Chrome-100 fingerprint and need a newer
// one. Use the curl_chrome131 wrapper that ships alongside the binary; fall back
// to the chrome-100 path if the wrapper isn't present.
const CHROME131_BIN = path.join(path.dirname(CURL_BIN), "curl_chrome131");
export async function impersonateFetchModern(url: string): Promise<string> {
  const safe = safeHttpUrl(url);
  if (!safe) throw new Error("Refusing to fetch non-http(s) URL");
  const useWrapper = fs.existsSync(CHROME131_BIN);
  const bin = useWrapper ? CHROME131_BIN : CURL_BIN;
  const args = useWrapper
    ? ["-sL", "--max-time", "30", "--", safe]
    : [...IMPERSONATE_ARGS, "-sL", "--max-time", "30", "--", safe];
  try {
    const { stdout } = await execFileAsync(bin, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 35000,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    throw new Error(`Could not fetch page (${(err as Error).message.slice(0, 80)})`);
  }
}

// Download an image to destAbs via curl-impersonate; returns byte size or 0.
export async function impersonateDownload(
  url: string,
  destAbs: string
): Promise<number> {
  const safe = safeHttpUrl(url);
  if (!safe) return 0;
  try {
    ensureDir(path.dirname(destAbs));
    await execFileAsync(
      CURL_BIN,
      [...IMPERSONATE_ARGS, "-sL", "--max-time", "60", "-o", destAbs, "--", safe],
      { timeout: 65000, maxBuffer: 1024 }
    );
    return fs.existsSync(destAbs) ? fs.statSync(destAbs).size : 0;
  } catch {
    return 0;
  }
}

// Shared og:<prop> extractor + minimal HTML entity decode for mod-apk pages.
export function ogTag(html: string, prop: string): string | null {
  const m = html.match(
    new RegExp(`<meta property=["']og:${prop}["'] content=["']([^"']*)["']`, "i")
  );
  return m ? decodeEntities(m[1]).trim() || null : null;
}

// Extract a clean app name + version from a mod-apk page's og:title, e.g.
// "PornTotal v1.8.0 MOD APK (Premium Unlocked) Download" -> { PornTotal, 1.8.0 }
// "TikPorn MOD APK v3.5.7 ... - MOD APK WORLD"           -> { TikPorn, 3.5.7 }
// "FikFap APK v3.3.4 Download for Android [Short Videos]" -> { FikFap, 3.3.4 }
export function parseModTitle(title: string): {
  name: string;
  version: string | null;
} {
  const version = title.match(/\bv(\d+(?:\.\d+)+[a-z0-9.]*)/i)?.[1] || null;
  const name =
    title
      .replace(/\s+v\d[\w.]*.*$/i, "") // cut from the version token onward
      .replace(/\s+(MOD\s+)?APK\b.*$/i, "") // else cut from "APK" onward
      .replace(/\s*[-–|]\s*$/, "")
      .trim() || title;
  return { name, version };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
