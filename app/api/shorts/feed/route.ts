import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessChannel,
  getFeed,
  getProfileSummary,
  parseChannel,
} from "@/lib/shorts";
import { parseCategory } from "@/lib/shorts-categories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw && !isNaN(Number(cursorRaw)) ? Number(cursorRaw) : null;
  const profileRaw = url.searchParams.get("profile");
  const profileId = profileRaw && !isNaN(Number(profileRaw)) ? Number(profileRaw) : null;
  const playlistRaw = url.searchParams.get("playlist");
  const playlistId = playlistRaw && !isNaN(Number(playlistRaw)) ? Number(playlistRaw) : null;
  // Person scope: union the owner's own uploads (uploader_id) with the profile.
  const ownerRaw = url.searchParams.get("owner");
  const ownerId = ownerRaw && !isNaN(Number(ownerRaw)) ? Number(ownerRaw) : null;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = limitRaw && limitRaw > 0 ? Math.min(limitRaw, 40) : 10;
  // Optional 18+ category filter for channel-scoped browsing.
  const category = parseCategory(url.searchParams.get("category"));
  // "Mine" view: only the viewer's own uploads (public + private).
  const mineOnly = url.searchParams.get("mine") === "1";
  const isAdmin = session.role === "admin";

  // Profile-scoped feed: derive the channel from the profile so 18+ gating still
  // applies. Channel-scoped feed: use the requested channel.
  let channel = parseChannel(url.searchParams.get("channel"));
  if (profileId) {
    const profile = getProfileSummary(profileId);
    if (!profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    channel = profile.channel;
  }

  if (!(await canAccessChannel(channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }
  // Whether this viewer may receive 18+ clips at all — gates the playlist /
  // cross-channel scopes that don't constrain the channel themselves.
  const allow18 = await canAccessChannel("18plus");

  const { items, nextCursor } = getFeed(
    channel,
    Number(session.sub),
    cursor,
    limit,
    profileId,
    playlistId,
    category,
    isAdmin,
    mineOnly,
    ownerId,
    allow18
  );

  return NextResponse.json({ items, nextCursor });
}
