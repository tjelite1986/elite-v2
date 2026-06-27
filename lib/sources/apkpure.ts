// APKPure source: an app's metadata (name, full description, icon, screenshots,
// latest version) scraped from the apkpure.com app page. APKPure is Cloudflare-
// gated and 403s the Chrome-100 fingerprint, so we fetch with the newer Chrome-131
// impersonation (impersonateFetchModern). Used for "Link APKPure" enrichment +
// version-check only — never changes how the APK is served.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import {
  impersonateFetchModern,
  impersonateDownloadModern,
  ogTag,
  decodeEntities,
} from "./impersonate";

export interface ApkpureMeta {
  url: string;
  packageName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  screenshots: string[];
  version: string | null;
}

// Accept a full apkpure URL (apkpure.com/<slug>/<package>). Returns the canonical
// https URL, or throws if it isn't an apkpure address.
export function normalizeUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("APKPure URL required");
  let u: URL;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new Error("Invalid APKPure URL");
  }
  if (!/(^|\.)apkpure\.(com|net)$/i.test(u.hostname)) {
    throw new Error("Not an apkpure.com URL");
  }
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/$/, "");
}

// The package id is the last path segment of an apkpure app URL.
function packageFromUrl(url: string): string {
  const seg = url.split("?")[0].replace(/\/$/, "").split("/").pop() || "";
  return /^[a-zA-Z0-9._]+$/.test(seg) ? seg : "";
}

function jsonLdApp(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      const t = (it as { "@type"?: unknown })["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (types.includes("MobileApplication") || types.includes("SoftwareApplication")) {
        return it as Record<string, unknown>;
      }
    }
  }
  return null;
}

function screenshotsFrom(app: Record<string, unknown> | null): string[] {
  const raw = app?.screenshot;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    const url = typeof s === "string" ? s : (s as { url?: string })?.url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) out.push(decodeEntities(url));
  }
  return out.slice(0, 8);
}

// Pick the app icon: a winudf image1 URL whose base64 path segment decodes to
// "<package>_icon_…" (the page also lists related-app icons, so match by package).
function iconFrom(html: string, pkg: string): string | null {
  const urls = html.match(/https?:\/\/image[^\s"'\\]*winudf\.com\/v2\/image1\/[^\s"'\\]+/gi) || [];
  for (const raw of urls) {
    const url = decodeEntities(raw);
    const seg = url.split("/v2/image1/")[1]?.split("/")[0] || "";
    let decoded = "";
    try {
      decoded = Buffer.from(seg, "base64").toString("utf8");
    } catch {
      continue;
    }
    if (decoded.startsWith(`${pkg}_icon`) || (pkg && decoded.includes(`${pkg}_icon`))) {
      return url;
    }
  }
  // Fallback: first non-screenshot icon image on the page.
  for (const raw of urls) {
    const url = decodeEntities(raw);
    if (/\/icon\.(webp|png|jpe?g)/i.test(url) && !/_screen/i.test(url)) return url;
  }
  return null;
}

// "FikFap 4.1.0 APK download for Android. …" -> "4.1.0"
function versionFrom(html: string): string | null {
  const desc = ogTag(html, "description") || "";
  const m = desc.match(/(\d+(?:\.\d+)+)\s+APK\b/i) || desc.match(/\b(\d+(?:\.\d+)+)\b/);
  return m ? m[1] : null;
}

export async function fetchMeta(input: string): Promise<ApkpureMeta> {
  const url = normalizeUrl(input);
  const pkg = packageFromUrl(url);
  const html = await impersonateFetchModern(url);
  if (/Page Not Found|404 Not Found/i.test(html) && html.length < 6000) {
    throw new Error("APKPure page not found");
  }
  const app = jsonLdApp(html);
  const name =
    (typeof app?.name === "string" && app.name) ||
    (ogTag(html, "title") || "").replace(/ APK.*$/i, "").trim() ||
    pkg;
  const description =
    typeof app?.description === "string" && app.description.trim()
      ? decodeEntities(app.description.trim())
      : null;
  return {
    url,
    packageName: pkg,
    name,
    description,
    iconUrl: iconFrom(html, pkg),
    screenshots: screenshotsFrom(app),
    version: versionFrom(html),
  };
}

export async function fetchVersion(input: string): Promise<string | null> {
  try {
    const html = await impersonateFetchModern(normalizeUrl(input));
    return versionFrom(html);
  } catch {
    return null;
  }
}

// Download the app's package from APKPure and return a single installable base
// .apk in destDir. APKPure serves an XAPK (zip of base.apk + config splits) for
// most apps; we extract the base apk (`<pkg>.apk`, or the first non-split apk).
// `splits` > 0 means resource/language splits were dropped (base still installs).
export async function downloadBaseApk(
  input: string,
  destDir: string
): Promise<{ apkPath: string; fileName: string; version: string | null; splits: number }> {
  const url = normalizeUrl(input);
  const pkg = packageFromUrl(url);
  if (!pkg) throw new Error("Could not determine the package id from the APKPure URL");
  const version = await fetchVersion(url);
  const xapkUrl = `https://d.apkpure.com/b/XAPK/${pkg}?version=latest`;
  const tmp = path.join(os.tmpdir(), `apkpure-${pkg}-${Date.now()}.bin`);

  const size = await impersonateDownloadModern(xapkUrl, tmp);
  if (!size) throw new Error("APKPure download failed (empty response)");

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(tmp));
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const apkEntries = entries.filter((f) => /\.apk$/i.test(f.name) && !f.name.includes("/"));
    fs.mkdirSync(destDir, { recursive: true });
    const fileName = `${pkg}-${version || "latest"}.apk`;
    const apkPath = path.join(destDir, fileName);

    if (apkEntries.length === 0) {
      // Already a bare APK (a zip with AndroidManifest/classes, no nested .apk).
      const bareApk = entries.some((f) =>
        /^AndroidManifest\.xml$/i.test(f.name) || /^classes\d*\.dex$/i.test(f.name)
      );
      if (!bareApk) throw new Error("Unrecognized APKPure download (not an APK/XAPK)");
      fs.copyFileSync(tmp, apkPath);
      return { apkPath, fileName, version, splits: 0 };
    }

    // XAPK → base apk = `<pkg>.apk`, else the first non-config/non-split apk.
    const nonSplit = apkEntries.filter(
      (f) => !/(^|\/)(config\.|split_)/i.test(f.name)
    );
    const base =
      apkEntries.find((f) => f.name.toLowerCase() === `${pkg.toLowerCase()}.apk`) ||
      nonSplit[0] ||
      apkEntries[0];
    fs.writeFileSync(apkPath, await base.async("nodebuffer"));
    return { apkPath, fileName, version, splits: apkEntries.length - 1 };
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}
