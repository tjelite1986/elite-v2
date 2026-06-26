import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveSubscription } from "@/lib/push";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const sub = body?.subscription ?? body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  saveSubscription(Number(session.sub), sub);
  return NextResponse.json({ ok: true });
}
