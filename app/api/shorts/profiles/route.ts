import { NextResponse } from "next/server";
import { sql } from "kysely";
import { getSession } from "@/lib/auth";
import { db, ShortProfileRow } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";
import { deriveProfileName } from "@/lib/shorts-source";
import { triggerPoll } from "@/lib/shorts-poll";
import { handleOf } from "@/lib/directory";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role !== "admin") return { error: "Forbidden", status: 403 as const };
  return { session };
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Optional channel filter so each section only manages its own profiles.
  const channelParam = new URL(request.url).searchParams.get("channel");
  const channel =
    channelParam === "18plus" || channelParam === "main" ? channelParam : null;

  const profiles = getAll<ShortProfileRow & { clip_count: number }>(
    qb
      .selectFrom("short_profiles as p")
      .selectAll("p")
      .select(
        sql<number>`(SELECT COUNT(*) FROM shorts s WHERE s.profile_id = p.id AND s.is_deleted = 0)`.as(
          "clip_count"
        )
      )
      .$if(channel !== null, (q) => q.where("p.channel", "=", channel!))
      .orderBy("p.created_at", "desc")
  );

  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  let name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceRef = typeof body.source_ref === "string" ? body.source_ref.trim() : "";
  const channel = body.channel === "18plus" ? "18plus" : "main";
  const sourceType =
    body.source_type === "rss"
      ? "rss"
      : body.source_type === "manual"
        ? "manual"
        : "yt-dlp";
  const videosLimit = Math.max(1, Math.min(Number(body.videos_limit) || 20, 100));
  // Manual profiles have no poll source: they never auto-poll and clips arrive
  // via the import folder or upload instead.
  const isManual = sourceType === "manual";
  const autoPoll = isManual ? 0 : body.auto_poll ? 1 : 0;

  if (isManual) {
    if (!name) {
      return NextResponse.json(
        { error: "A name is required for a manual profile." },
        { status: 400 }
      );
    }
  } else {
    if (!sourceRef) {
      return NextResponse.json({ error: "A source is required." }, { status: 400 });
    }
    // Auto-derive the display name from the source when left blank.
    if (!name) {
      name = await deriveProfileName(sourceType, sourceRef);
    }
  }

  // Reuse an existing profile with the same handle in this channel instead of
  // creating a capitalization variant (prevents split profiles).
  const handle = handleOf(name);
  if (handle) {
    const existing = getAll<{ id: number; name: string }>(
      qb.selectFrom("short_profiles").select(["id", "name"]).where("channel", "=", channel)
    ).find((p) => handleOf(p.name) === handle);
    if (existing) {
      const full = getOne(
        qb.selectFrom("short_profiles").selectAll().where("id", "=", existing.id)
      );
      return NextResponse.json({ ok: true, profile: full, reused: true });
    }
  }

  const result = db
    .prepare(
      `INSERT INTO short_profiles
         (name, channel, source_type, source_ref, auto_poll, videos_limit)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, channel, sourceType, isManual ? "" : sourceRef, autoPoll, videosLimit);

  const id = Number(result.lastInsertRowid);
  // Start fetching immediately so the admin sees clips without waiting for the
  // 30-minute timer (manual profiles have nothing to poll).
  if (!isManual) triggerPoll(id);

  const profile = getOne(
    qb.selectFrom("short_profiles").selectAll().where("id", "=", id)
  );

  return NextResponse.json({ ok: true, profile });
}
