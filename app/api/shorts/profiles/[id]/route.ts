import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role !== "admin") return { error: "Forbidden", status: 403 as const };
  return { session };
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const existing = getOne<ShortProfileRow>(
    qb.selectFrom("short_profiles").selectAll().where("id", "=", Number(params.id))
  );
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
  const sourceRef =
    typeof body.source_ref === "string" && body.source_ref.trim()
      ? body.source_ref.trim()
      : existing.source_ref;
  const channel =
    body.channel === "main" || body.channel === "18plus" ? body.channel : existing.channel;
  const sourceType =
    body.source_type === "yt-dlp" || body.source_type === "rss"
      ? body.source_type
      : existing.source_type;
  const videosLimit =
    body.videos_limit !== undefined
      ? Math.max(1, Math.min(Number(body.videos_limit) || 20, 100))
      : existing.videos_limit;
  const autoPoll =
    body.auto_poll !== undefined ? (body.auto_poll ? 1 : 0) : existing.auto_poll;

  db.prepare(
    `UPDATE short_profiles
        SET name = ?, channel = ?, source_type = ?, source_ref = ?,
            auto_poll = ?, videos_limit = ?
      WHERE id = ?`
  ).run(name, channel, sourceType, sourceRef, autoPoll, videosLimit, existing.id);

  const profile = getOne(
    qb.selectFrom("short_profiles").selectAll().where("id", "=", existing.id)
  );
  return NextResponse.json({ ok: true, profile });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Keep already-imported clips; just detach them (FK is ON DELETE SET NULL).
  db.prepare("DELETE FROM short_profiles WHERE id = ?").run(Number(params.id));
  return NextResponse.json({ ok: true });
}
