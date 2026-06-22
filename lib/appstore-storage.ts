import fs from "node:fs";
import path from "node:path";
import { APPSTORE_ROOT } from "./appstore-archive";

// Writable area for externally-sourced apps (GitHub/F-Droid downloads +
// ingested icons/screenshots). The read-only archive (APPSTORE_ROOT) holds the
// curated local catalog; this holds everything fetched from the internet.
export const STORE_DIR =
  process.env.STORE_DIR || "/mnt/4tb/elitev2/appstore-downloads";

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// The storage root for an app's assets/artifacts: local apps live in the
// read-only archive, everything else in the writable download store.
export function rootForSource(source: string): string {
  return source === "local" ? APPSTORE_ROOT : STORE_DIR;
}

// Resolve a stored key under a given root, refusing path traversal.
export function resolveUnder(root: string, key: string): string | null {
  if (!key) return null;
  const abs = path.resolve(root, key);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

// Keys prefixed with this resolve under the writable STORE_DIR regardless of the
// app's primary source — lets an externally-fetched asset (e.g. a banner pulled
// for a local archive app) live in the writable store without a schema change.
const STORE_PREFIX = "store:";

export function storeKey(relPath: string): string {
  return STORE_PREFIX + relPath;
}

// Resolve an asset/apk key for an app, picking the correct root. A "store:"
// prefix forces STORE_DIR; otherwise the app's source decides the root.
export function resolveAppFile(source: string, key: string): string | null {
  if (key.startsWith(STORE_PREFIX)) {
    return resolveUnder(STORE_DIR, key.slice(STORE_PREFIX.length));
  }
  return resolveUnder(rootForSource(source), key);
}
