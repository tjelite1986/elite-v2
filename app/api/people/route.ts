import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getShowAdultOutside } from "@/lib/profiles";
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

  // 18+ clip counts contribute to the directory only when the PIN is unlocked
  // AND the user opted to see adult content outside the 18+ section.
  const include18 =
    (await has18Access()) && getShowAdultOutside(Number(session.sub));
  const all = getPeople({ q, include18 });
  const items = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : null;

  return NextResponse.json({ items, total: all.length, nextOffset });
}
