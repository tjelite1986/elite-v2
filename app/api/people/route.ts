import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getPeople } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Paginated cross-section people directory. 18+ clip counts only contribute once
// the shorts18 PIN is unlocked.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 60);

  const include18 = await has18Access();
  const all = getPeople({ q, include18 });
  const items = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : null;

  return NextResponse.json({ items, total: all.length, nextOffset });
}
