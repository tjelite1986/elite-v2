import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { removeSubscription } from "@/lib/push";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint === "string" && endpoint) removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
