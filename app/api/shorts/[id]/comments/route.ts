import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortCommentRow } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";
import { canAccessChannel, canViewShort, getShort } from "@/lib/shorts";

export const dynamic = "force-dynamic";

interface CommentWithAuthor extends ShortCommentRow {
  author_email: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewShort(short, Number(session.sub), session.role === "admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const comments = getAll<CommentWithAuthor>(
    qb
      .selectFrom("short_comments as c")
      .leftJoin("users as u", "u.id", "c.user_id")
      .selectAll("c")
      .select("u.email as author_email")
      .where("c.short_id", "=", short.id)
      .orderBy("c.created_at")
      .orderBy("c.id")
  );

  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewShort(short, userId, session.role === "admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const reqBody = await request.json().catch(() => ({}));
  const body = typeof reqBody?.body === "string" ? reqBody.body.trim() : "";
  if (!body) {
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });
  }

  const result = db
    .prepare(
      "INSERT INTO short_comments (short_id, user_id, body) VALUES (?, ?, ?)"
    )
    .run(short.id, userId, body.slice(0, 2000));

  const comment = getOne<CommentWithAuthor>(
    qb
      .selectFrom("short_comments as c")
      .leftJoin("users as u", "u.id", "c.user_id")
      .selectAll("c")
      .select("u.email as author_email")
      .where("c.id", "=", Number(result.lastInsertRowid))
  )!;

  return NextResponse.json({ ok: true, comment });
}
