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

export async function fetchMeta(packageId: string): Promise<FdroidMeta> {
  const { suggested, versions } = await fetchVersions(packageId);
  let name = packageId;
  let summary: string | null = null;
  let iconUrl: string | null = null;
  try {
    const res = await fetch(`${FDROID_BASE}/en/packages/${packageId}/`, {
      headers: { "User-Agent": "elite-v2-appstore" },
    });
    if (res.ok) {
      const html = await res.text();
      name = (ogTag(html, "title") || packageId).replace(/ \| F-Droid.*$/, "");
      summary = ogTag(html, "description");
      iconUrl = ogTag(html, "image");
    }
  } catch {
    /* metadata is best-effort */
  }
  return { packageName: packageId, name, summary, iconUrl, suggestedVersionCode: suggested, versions };
}

// Standard F-Droid APK filename + URL convention.
export function apkUrl(packageId: string, versionCode: number): string {
  return `${FDROID_REPO_URL}/${packageId}_${versionCode}.apk`;
}
