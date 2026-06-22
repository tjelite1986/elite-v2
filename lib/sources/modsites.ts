import type { ModApkMeta } from "./latestmodapks";
import * as latestmodapks from "./latestmodapks";
import * as modapkworld from "./modapkworld";
import * as ninemod from "./ninemod";

// Mod-apk metadata sites, dispatched by hostname. Each parser fetches past
// Cloudflare via curl-impersonate and returns the same ModApkMeta shape.
const SITES = [
  { match: /9mod\.com/i, mod: ninemod },
  { match: /modapk\.world/i, mod: modapkworld },
  { match: /latestmodapks\.com/i, mod: latestmodapks },
];

function pick(input: string) {
  const hit = SITES.find((s) => s.match.test(input));
  // Bare slug with no host → default to latestmodapks (original behaviour).
  return hit ? hit.mod : latestmodapks;
}

export async function fetchModSiteMeta(input: string): Promise<ModApkMeta> {
  return pick(input).fetchAppMeta(input);
}

export async function fetchModSiteVersion(input: string): Promise<string | null> {
  return pick(input).fetchAppVersion(input);
}

export const SUPPORTED_MOD_SITES = ["latestmodapks.com", "modapk.world", "9mod.com"];
