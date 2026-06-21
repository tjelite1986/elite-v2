import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { handleOf } from "@/lib/directory";
import { getProfileExtras } from "@/lib/profiles";
import { fetchProfileInfo, triggerSync, SyncMode } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same rule as profile extras: admins, or the user whose own handle this is.
async function authorize(handle: string) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role === "admin") return { session };
  const me = db
    .prepare("SELECT username FROM user_profiles WHERE user_id = ?")
    .get(Number(session.sub)) as { username: string } | undefined;
  if (me && handleOf(me.username) === handle) return { session };
  return { error: "Forbidden", status: 403 as const };
}

// Sync status for the profile, so the manage widget can poll while a background
// download runs.
export async function GET(
  _request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const extras = getProfileExtras(handle);
  return NextResponse.json({
    instagramHandle: extras?.instagramHandle ?? null,
    autoPoll: extras?.igAutoPoll ?? false,
    syncing: extras?.igSyncing ?? false,
    lastSyncedAt: extras?.igLastSyncedAt ?? null,
    lastSyncError: extras?.igLastSyncError ?? null,
  });
}

// Kick off a media download from this profile's connected Instagram account.
// Refreshes the avatar/info inline (fast), then runs the download + ingest in
// the background. Returns immediately.
export async function POST(
  request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const extras = getProfileExtras(handle);
  const ig = extras?.instagramHandle;
  if (!ig) {
    return NextResponse.json(
      { error: "No Instagram username connected to this profile." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string };

  // Info-only: refresh the profile's name/bio/avatar/links from Instagram with
  // no media download. Fast + inline.
  if (body.mode === "info") {
    const fetched = await fetchProfileInfo(ig, handle);
    return NextResponse.json({ ok: true, mode: "info", fetched: Boolean(fetched) });
  }

  const mode: SyncMode = body.mode === "photos" ? "photos" : "all";
  // Mark syncing right away so the UI reflects it before the detached job writes
  // its own status; refresh the profile's avatar/name from Instagram inline.
  db.prepare("UPDATE profile_extras SET ig_syncing = 1 WHERE handle = ?").run(handle);
  try {
    await fetchProfileInfo(ig, handle);
  } catch {
    /* info is best effort; the media download is what matters */
  }
  triggerSync(handle, mode);
  return NextResponse.json({ ok: true, mode });
}
