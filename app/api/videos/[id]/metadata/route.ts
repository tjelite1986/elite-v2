import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideo } from "@/lib/videos";
import {
  applyMatchById,
  candidatesFor,
  clearMetadata,
  parseMetadata,
} from "@/lib/video-metadata";
import { tpdbConfigured } from "@/lib/tpdb";

export const dynamic = "force-dynamic";
// A lookup fans out over several search variants against a third-party API.
export const maxDuration = 120;

// Metadata is an 18+ library feature: ThePornDB has nothing to say about the
// main channel, and admins are the only ones who can change library-wide data.
async function load(id: string, needAdmin: boolean) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (needAdmin && session.role !== "admin") {
    return { error: "Forbidden", status: 403 as const };
  }
  const video = getVideo(Number(id));
  if (!video) return { error: "Not found", status: 404 as const };
  if (video.channel !== "adults") {
    return { error: "Metadata lookup is 18+ only", status: 400 as const };
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { video };
}

// Current metadata, plus candidates when ?search=1 (optionally ?q=<free text>).
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const url = new URL(request.url);
  const wantSearch = url.searchParams.get("search") === "1";
  const loaded = await load(id, wantSearch);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  if (!wantSearch) {
    return NextResponse.json({ metadata: parseMetadata(loaded.video) });
  }
  if (!tpdbConfigured()) {
    return NextResponse.json({ error: "TPDB_API_KEY is not set" }, { status: 503 });
  }
  try {
    const candidates = await candidatesFor(
      loaded.video,
      url.searchParams.get("q") || undefined
    );
    return NextResponse.json({ candidates });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err) },
      { status: 502 }
    );
  }
}

// Apply a candidate the user picked: { id: "<tpdb uuid>", type: "movie"|"scene" }.
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const loaded = await load(id, true);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const body = await request.json().catch(() => ({}));
  const tpdbId = typeof body.id === "string" ? body.id : null;
  const type = body.type === "scene" ? "scene" : "movie";
  if (!tpdbId) {
    return NextResponse.json({ error: "Missing match id" }, { status: 400 });
  }
  const ok = await applyMatchById(loaded.video, tpdbId, type);
  if (!ok) {
    return NextResponse.json({ error: "That entry no longer exists" }, { status: 404 });
  }
  const fresh = getVideo(loaded.video.id);
  return NextResponse.json({
    ok: true,
    metadata: fresh ? parseMetadata(fresh) : null,
  });
}

// Clear a wrong match (and its downloaded cover).
export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const loaded = await load(id, true);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  clearMetadata(loaded.video);
  return NextResponse.json({ ok: true });
}
