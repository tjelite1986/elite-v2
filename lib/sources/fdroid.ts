// F-Droid source: versions via the clean packages API, metadata scraped from the
// app page's Open Graph tags (avoids downloading the multi-MB repo index).

export const FDROID_REPO_URL =
  process.env.FDROID_REPO_URL || "https://f-droid.org/repo";

const FDROID_BASE = FDROID_REPO_URL.replace(/\/repo\/?$/, "");

export interface FdroidVersion {
  versionName: string;
  versionCode: number;
}

export interface FdroidMeta {
  packageName: string;
  name: string;
  summary: string | null;
  description: string | null;
  iconUrl: string | null;
  suggestedVersionCode: number;
  versions: FdroidVersion[];
}

export function normalizePackageId(input: string): string {
  const s = input.trim();
  const m = s.match(/packages\/([a-zA-Z0-9._]+)/);
  return m ? m[1] : s;
}

export async function fetchVersions(packageId: string): Promise<{
  suggested: number;
  versions: FdroidVersion[];
}> {
  const res = await fetch(`${FDROID_REPO_URL.replace(/\/repo$/, "")}/api/v1/packages/${packageId}`, {
    headers: { "User-Agent": "elite-v2-appstore" },
  });
  if (res.status === 404) throw new Error("F-Droid package not found");
  if (!res.ok) throw new Error(`F-Droid API error ${res.status}`);
  const j = (await res.json()) as {
    suggestedVersionCode?: number;
    packages?: { versionName: string; versionCode: number }[];
  };
  return {
    suggested: j.suggestedVersionCode || 0,
    versions: (j.packages || []).map((p) => ({
      versionName: p.versionName,
      versionCode: p.versionCode,
    })),
  };
}

function ogTag(html: string, prop: string): string | null {
  const m = html.match(
    new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  return m ? m[1] : null;
}

// Convert the F-Droid description block's HTML (br/p/li/a + entities) to readable
// plain text (bullets kept as "* " so it still reads as markdown downstream).
function htmlToText(s: string): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "* ")
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The full app description from the F-Droid page body (the og:description meta is
// only the short summary).
function extractDescription(html: string): string | null {
  const m = html.match(
    /<div class="package-description"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (!m) return null;
  const text = htmlToText(m[1]);
  return text || null;
}

export async function fetchMeta(packageId: string): Promise<FdroidMeta> {
  const { suggested, versions } = await fetchVersions(packageId);
  let name = packageId;
  let summary: string | null = null;
  let description: string | null = null;
  let iconUrl: string | null = null;
  try {
    const res = await fetch(`${FDROID_BASE}/en/packages/${packageId}/`, {
      headers: { "User-Agent": "elite-v2-appstore" },
    });
    if (res.ok) {
      const html = await res.text();
      name = (ogTag(html, "title") || packageId).replace(/ \| F-Droid.*$/, "");
      summary = ogTag(html, "description");
      description = extractDescription(html);
      iconUrl = ogTag(html, "image");
    }
  } catch {
    /* metadata is best-effort */
  }
  return { packageName: packageId, name, summary, description, iconUrl, suggestedVersionCode: suggested, versions };
}

// Standard F-Droid APK filename + URL convention.
export function apkUrl(packageId: string, versionCode: number): string {
  return `${FDROID_REPO_URL}/${packageId}_${versionCode}.apk`;
}
