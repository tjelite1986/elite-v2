import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBook, getReadingState, setReadingState } from "@/lib/books";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    state: getReadingState(params.slug, Number(session.sub)),
  });
}

export async function POST(
  request: Request,
  { params }: { params: { slug: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getBook(params.slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const patch: { position?: string; percent?: number; finished?: boolean } = {};
  if (typeof body.position === "string") patch.position = body.position;
  if (typeof body.percent === "number") patch.percent = body.percent;
  if (typeof body.finished === "boolean") patch.finished = body.finished;
  setReadingState(params.slug, Number(session.sub), patch);
  return NextResponse.json({ ok: true });
}
