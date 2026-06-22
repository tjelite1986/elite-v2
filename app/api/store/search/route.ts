import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { searchApps } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const items = searchApps(Number(session.sub), await has18Access(), {
    q: url.searchParams.get("q") || undefined,
    category: url.searchParams.get("category") || undefined,
    section: url.searchParams.get("section") || undefined,
    sort: url.searchParams.get("sort") || undefined,
  });
  return NextResponse.json({ items });
}
