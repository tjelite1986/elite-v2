// Google Play source: metadata + version-check ONLY. We never host or download
// Play APKs — a Play app links out to the store. Uses google-play-scraper.

export interface PlayMeta {
  packageId: string;
  name: string;
  summary: string | null;
  description: string | null;
  developer: string | null;
  iconUrl: string | null;
  screenshots: string[];
  score: number;
  ratings: number;
  version: string | null;
  url: string;
  genre: string | null;
}

// google-play-scraper v10 is ESM; load it dynamically so it works regardless of
// the module system Next compiles this file into.
async function gplay(): Promise<any> {
  const mod: any = await import("google-play-scraper");
  return mod.default ?? mod;
}

export async function fetchAppMeta(packageId: string): Promise<PlayMeta> {
  const gp = await gplay();
  let app: any;
  try {
    app = await gp.app({ appId: packageId });
  } catch {
    throw new Error("Play Store app not found");
  }
  return {
    packageId,
    name: app.title || packageId,
    summary: app.summary || null,
    description: app.description || null,
    developer: app.developer || null,
    iconUrl: app.icon || null,
    screenshots: Array.isArray(app.screenshots) ? app.screenshots.slice(0, 8) : [],
    score: app.score || 0,
    ratings: app.ratings || 0,
    version: app.version && app.version !== "VARY" ? app.version : null,
    url: app.url || `https://play.google.com/store/apps/details?id=${packageId}`,
    genre: app.genre || null,
  };
}

export async function fetchAppVersion(
  packageId: string
): Promise<{ version: string | null; updated: string | null }> {
  const gp = await gplay();
  try {
    const app = await gp.app({ appId: packageId });
    return {
      version: app.version && app.version !== "VARY" ? app.version : null,
      updated: app.updated ? String(app.updated) : null,
    };
  } catch {
    throw new Error("Play Store app not found");
  }
}
