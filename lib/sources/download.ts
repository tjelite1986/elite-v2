import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir } from "../appstore-storage";

// Download a URL to a file atomically (.part -> rename). Follows redirects.
export async function downloadToFile(
  url: string,
  destPath: string,
  headers?: Record<string, string>
): Promise<number> {
  ensureDir(path.dirname(destPath));
  const res = await fetch(url, {
    headers: { "User-Agent": "elite-v2-appstore", ...(headers || {}) },
    redirect: "follow",
  });
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
