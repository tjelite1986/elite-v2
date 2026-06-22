import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import {
  enumerateCandidates,
  downloadOne,
  assertDownloadableUrl,
} from "@/lib/shorts-download";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function adminProfile(id: number) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role !== "admin") return { error: "Forbidden", status: 403 as const };
  const profile = getOne<ShortProfileRow>(
    qb.selectFrom("short_profiles").selectAll().where("id", "=", id)
  );
  if (!profile) return { error: "Not found", status: 404 as const };
  return { profile };
}

// List available clips from the profile's source with thumbnails + meta.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await adminProfile(Number(params.id));
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const candidates = enumerateCandidates(auth.profile, 40);
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[shorts] candidates failed:", err);
    const message =
      err instanceof Error ? err.message : "Could not list videos for this source.";
    // 422 (not 5xx): an expected source-side condition. The reverse proxy
    // replaces 5xx bodies with its own page, swallowing our message.
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

// Download a single chosen clip (body: { id, url, title }).
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await adminProfile(Number(params.id));
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const title = typeof body.title === "string" ? body.title : null;
  // Derive the source id from the URL when not supplied (manual "add by URL"):
  // TikTok /video/<id>, YouTube ?v=<id>/shorts/<id>, else the URL itself.
  let sourceId = body.id != null ? String(body.id) : "";
  if (!sourceId && url) {
    sourceId =
      url.match(/\/video\/(\d+)/)?.[1] ||
      url.match(/[?&]v=([\w-]+)/)?.[1] ||
      url.match(/\/shorts\/([\w-]+)/)?.[1] ||
      url;
  }
  if (!url || !sourceId) {
    return NextResponse.json({ error: "A video URL is required." }, { status: 400 });
  }

  // SSRF guard: only fetch public http(s) URLs (the host must not resolve to a
  // private/loopback address) before handing the URL to yt-dlp.
  try {
    await assertDownloadableUrl(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid URL." },
      { status: 400 }
    );
  }

  try {
    const shortId = downloadOne(auth.profile, url, sourceId, title);
    if (!shortId) {
      return NextResponse.json({ ok: true, alreadyDownloaded: true });
    }
    return NextResponse.json({ ok: true, shortId });
  } catch (err) {
    console.error("[shorts] download failed:", err);
    return NextResponse.json({ error: "Download failed." }, { status: 422 });
  }
}
