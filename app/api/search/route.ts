import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/adult-gate";
import { globalSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

// Global search across everything the viewer is allowed to see: people, post
// captions, own DMs, joined channels, own gallery, videos and books.
// Privacy scoping happens inside globalSearch (18+ gate, DM pair, channel
// membership, gallery owner, video visibility).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({
      people: [], messages: [], channelMessages: [],
      gallery: [], videos: [], books: [],
    });
  }
  const adult = await has18Access();
  const results = globalSearch(q, {
    userId: Number(session.sub),
    isAdmin: session.role === "admin",
    adult,
  });
  return NextResponse.json(results);
}
