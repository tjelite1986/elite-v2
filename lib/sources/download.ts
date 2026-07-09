import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir } from "../appstore-storage";
import { assertPublicUrl } from "../link-preview";

const MAX_REDIRECTS = 5;

// Download a URL to a file atomically (.part -> rename). Redirects are followed
// manually so every hop — not just the first URL — is validated against the
// private/reserved-address blocklist (a trusted API response can still redirect
// to a private host).
export async function downloadToFile(
  url: string,
  destPath: string,
  headers?: Record<string, string>
): Promise<number> {
  ensureDir(path.dirname(destPath));
  let target = new URL(url);
  let res: Response;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(target);
    res = await fetch(target, {
      headers: { "User-Agent": "elite-v2-appstore", ...(headers || {}) },
      redirect: "manual",
    });
    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get("location");
    if (!location) throw new Error(`Redirect (${res.status}) without Location`);
    if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
    target = new URL(location, target);
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  const tmp = `${destPath}.part`;
  await pipeline(
    Readable.fromWeb(res.body as any),
    fs.createWriteStream(tmp)
  );
  fs.renameSync(tmp, destPath);
  return fs.statSync(destPath).size;
}

// Best-effort image download; returns the stored key relative to baseDir, or null.
export async function downloadImage(
  url: string,
  baseDir: string,
  relDir: string,
  fileBase: string
): Promise<string | null> {
  try {
    const ext = (url.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || "png").toLowerCase();
    const rel = path.join(relDir, `${fileBase}.${ext}`);
    await downloadToFile(url, path.join(baseDir, rel));
    return rel;
  } catch {
    return null;
  }
}
