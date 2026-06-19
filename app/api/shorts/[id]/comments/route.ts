import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortCommentRow } from "@/lib/db";
import { canAccessChannel, getShort } from "@/lib/shorts";

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
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const comments = db
    .prepare(
      `SELECT c.*, u.email AS author_email
         FROM short_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.short_id = ?
        ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(short.id) as CommentWithAuthor[];

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

  const comment = db
    .prepare(
      `SELECT c.*, u.email AS author_email
         FROM short_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as CommentWithAuthor;

  return NextResponse.json({ ok: true, comment });
}
