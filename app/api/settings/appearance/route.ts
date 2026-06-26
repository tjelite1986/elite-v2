import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAppearance, setAppearance } from "@/lib/appearance";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(getAppearance(Number(session.sub)));
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  setAppearance(Number(session.sub), {
    accent: body.accent,
    bgTheme: body.bgTheme,
  });
  return NextResponse.json({ ok: true, ...getAppearance(Number(session.sub)) });
}
