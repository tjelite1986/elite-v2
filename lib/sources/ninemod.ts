import { impersonateFetch, ogTag, parseModTitle } from "./impersonate";
import type { ModApkMeta } from "./latestmodapks";

// 9mod.com metadata via Open Graph tags. Pages live at 9mod.com/<slug>.html and
// og:image is the app's icon.

export function resolveUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/9mod\.com/i.test(s)) return `https://${s.replace(/^\/+/, "")}`;
  const slug = s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `https://9mod.com/${slug}.html`;
}

export async function fetchAppMeta(input: string): Promise<ModApkMeta> {
  const url = resolveUrl(input);
  const html = await impersonateFetch(url);

  const title = ogTag(html, "title");
  if (!title || /page not found|404 not found/i.test(title)) {
    throw new Error("Page not found on 9mod.com — check the URL or slug");
  }

  // "PornTotal v1.8.0 MOD APK (Premium Unlocked) Download"
  const { name, version } = parseModTitle(title);

  return {
    url,
    name,
    version,
    tagline: ogTag(html, "description"),
    description: ogTag(html, "description"),
    iconUrl: ogTag(html, "image"), // 9mod's og:image is the app icon
    bannerUrl: null,
    category: null,
  };
}

export async function fetchAppVersion(input: string): Promise<string | null> {
  return (await fetchAppMeta(input)).version;
}
