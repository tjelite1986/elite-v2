import { impersonateFetch, ogTag, parseModTitle } from "./impersonate";
import type { ModApkMeta } from "./latestmodapks";

// modapk.world metadata via Open Graph tags (fetched past Cloudflare with
// curl-impersonate). Pages live at modapk.world/<slug>-mod-apk/.

export function resolveUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/modapk\.world/i.test(s)) return `https://${s.replace(/^\/+/, "")}`;
  const slug = s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  // Pages use the "<slug>-mod-apk" pattern; tolerate a slug already ending in it.
  const path = /-mod-apk$/.test(slug) ? slug : `${slug}-mod-apk`;
  return `https://modapk.world/${path}/`;
}

export async function fetchAppMeta(input: string): Promise<ModApkMeta> {
  const url = resolveUrl(input);
  const html = await impersonateFetch(url);

  const title = ogTag(html, "title");
  if (!title || /page not found|404 not found/i.test(title)) {
    throw new Error("Page not found on modapk.world — check the URL or slug");
  }

  // "TikPorn MOD APK v3.5.7 (Premium Unlocked) Download - MOD APK WORLD"
  const { name, version } = parseModTitle(title);

  return {
    url,
    name,
    version,
    tagline: ogTag(html, "description"),
    description: ogTag(html, "description"),
    // modapk.world's og:image is the app's foreground icon/logo, not a banner.
    iconUrl: ogTag(html, "image"),
    bannerUrl: null,
    category: null,
  };
}

export async function fetchAppVersion(input: string): Promise<string | null> {
  return (await fetchAppMeta(input)).version;
}
