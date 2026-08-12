import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveMusic, musicError } from "@/lib/music-api";
import { parseLibrary, subsonicJson } from "@/lib/subsonic";
import { getAdminMusicCreds } from "@/lib/navidrome-accounts";

export const dynamic = "force-dynamic";

interface ScanStatus {
  scanStatus?: {
    scanning?: boolean;
    count?: number;
    folderCount?: number;
    lastScan?: string;
    scanType?: string;
  };
}

// Library scan state. Readable by anyone: it is just counts and a timestamp,
// and the music pages poll it to know when new files have landed.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;

  try {
    const res = await subsonicJson<ScanStatus>(resolved.ctx.creds, "getScanStatus");
    const s = res.scanStatus || {};
    return NextResponse.json({
      ok: true,
      scanning: Boolean(s.scanning),
      count: s.count ?? null,
      folderCount: s.folderCount ?? null,
      lastScan: s.lastScan ?? null,
      scanType: s.scanType ?? null,
    });
  } catch (e) {
    return musicError(e);
  }
}

// Trigger a scan. Two separate authorisations are at play and both matter:
//
//   - Elite side: admin only. A scan walks the whole library and is a shared
//     resource, not something each viewer should be able to kick off.
//   - Navidrome side: startScan is admin-only there too, and the per-user
//     `elite_<username>` accounts are deliberately NOT admins — calling it with
//     them answers code 50. So this one call runs as the configured Navidrome
//     admin rather than as the caller.
//
// `full=1` re-reads every file instead of only what changed on disk.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const library = parseLibrary(sp.get("library"));
  const full = sp.get("full") === "1";

  try {
    const creds = await getAdminMusicCreds(library);
    await subsonicJson(creds, "startScan", full ? { fullScan: true } : {});
    return NextResponse.json({ ok: true, full });
  } catch (e) {
    return musicError(e);
  }
}
