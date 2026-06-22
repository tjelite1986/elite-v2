import { impersonateFetch, ogTag, parseModTitle } from "./impersonate";

// latestmodapks.com metadata via Open Graph tags (fetched past Cloudflare with
// curl-impersonate). Per-app subdomains are soft-404 but carry real og tags.

export interface ModApkMeta {
  url: string;
  name: string;
  version: string | null;
  tagline: string | null;
  description: string | null;
  iconUrl: string | null; // app logo/icon (when the site's og:image is the icon)
  bannerUrl: string | null; // feature/banner image
  category: string | null;
}

// Accept a full URL, a "name.latestmodapks.com" host, or a bare slug.
export function resolveUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/latestmodapks\.com/i.test(s)) return `https://${s.replace(/^\/+/, "")}`;
  const slug = s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `https://www.latestmodapks.com/${slug}/`;
}

export async function fetchAppMeta(input: string): Promise<ModApkMeta> {
  const url = resolveUrl(input);
  const html = await impersonateFetch(url);

  const title = ogTag(html, "title");
  if (!title || /page not found/i.test(title)) {
    throw new Error("Page not found on latestmodapks — check the URL or slug");
  }

  // "FikFap APK v3.3.4 Download for Android [Short Videos]"
  const { name, version } = parseModTitle(title);
  const category = title.match(/\[([^\]]+)\]/)?.[1] || null;

  return {
    url,
    name,
    version,
    tagline: ogTag(html, "description"),
    description: ogTag(html, "description"),
    iconUrl: null, // latestmodapks og:image is a feature banner, not an icon
    bannerUrl: ogTag(html, "image"),
    category,
  };
}

export async function fetchAppVersion(input: string): Promise<string | null> {
  return (await fetchAppMeta(input)).version;
}
