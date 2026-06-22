import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import {
  getAppRow,
  upsertReview,
  deleteReview,
  canAccessApp,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canAccessApp(app, await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rating = 0;
  let body: string | null = null;
  try {
    const json = await request.json();
    rating = Number(json?.rating);
    body = typeof json?.body === "string" ? json.body.slice(0, 2000) : null;
  } catch {
    /* ignore */
  }
  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });
  }

  upsertReview(Number(session.sub), app.id, rating, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  deleteReview(Number(session.sub), app.id);
  return NextResponse.json({ ok: true });
}
