import { impersonateFetch, ogTag, parseModTitle } from "./impersonate";
import type { ModApkMeta } from "./latestmodapks";

// apkrmod.net metadata via Open Graph tags (WordPress mod-apk site). Pages live
// at apkrmod.net/<slug>/ and og:image is the app's image.

export function resolveUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/apkrmod\.net/i.test(s)) return `https://${s.replace(/^\/+/, "")}`;
  const slug = s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `https://apkrmod.net/${slug}/`;
}

export async function fetchAppMeta(input: string): Promise<ModApkMeta> {
  const url = resolveUrl(input);
  const html = await impersonateFetch(url);

  const title = ogTag(html, "title");
  if (!title || /page not found|404 not found|nothing found/i.test(title)) {
    throw new Error("Page not found on apkrmod.net — check the URL or slug");
  }

  // "TikTok 18+ Apk v1.7.4 (Mod,adult tiktok) Download Latest Version"
  const { name, version } = parseModTitle(title);

  return {
    url,
    name,
    version,
    tagline: ogTag(html, "description"),
    description: ogTag(html, "description"),
    iconUrl: ogTag(html, "image"), // apkrmod's og:image is the app image
    bannerUrl: null,
    category: null,
  };
}

export async function fetchAppVersion(input: string): Promise<string | null> {
  return (await fetchAppMeta(input)).version;
}
