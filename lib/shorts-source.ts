import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_BIN || "yt-dlp";

// Best-effort human name for an auto-poll source, used when the admin leaves the
// name blank. Falls back to a handle/segment parsed from the URL so creation
// never fails just because metadata lookup did.
export async function deriveProfileName(
  sourceType: "yt-dlp" | "rss",
  sourceRef: string
): Promise<string> {
  const resolved =
    sourceType === "rss"
      ? await deriveRssName(sourceRef)
      : await deriveYtDlpName(sourceRef);
  return resolved || nameFromUrl(sourceRef);
}

async function deriveYtDlpName(ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--flat-playlist",
        "--playlist-end", "1",
        "--dump-single-json",
        "--no-warnings",
        ref,
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }
    );
    const j = JSON.parse(stdout);
    const name = j.channel || j.uploader || j.title;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

async function deriveRssName(ref: string): Promise<string | null> {
  try {
    const res = await fetch(ref, {
      headers: { "User-Agent": "elitev2-shorts/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    // The channel/feed title is the first <title> before any item/entry.
    const head = xml.split(/<item|<entry/i)[0];
    const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = m?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    return title || null;
  } catch {
    return null;
  }
}

// e.g. https://www.tiktok.com/@lyra.elys -> "lyra.elys";
//      https://youtube.com/@MrBeast/shorts -> "MrBeast"
function nameFromUrl(ref: string): string {
  try {
    const u = new URL(ref);
    const handle = u.pathname
      .split("/")
      .find((seg) => seg.startsWith("@"));
    if (handle) return handle.slice(1);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg || u.hostname.replace(/^www\./, "");
  } catch {
    return ref.slice(0, 60) || "Profile";
  }
}
