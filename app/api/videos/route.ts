import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessVideoChannel,
  continueWatching,
  countVideos,
  listFolders,
  listVideos,
  type VideoSort,
} from "@/lib/videos";
import { parseVideoChannel } from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

const SORTS: VideoSort[] = ["added", "oldest", "title", "views", "duration"];

// Library listing for one channel. The 18+ channel is re-checked here (never
// trusting the page that rendered the browser) and folders/continue-watching
// ship along so the first paint needs a single request.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const channel = parseVideoChannel(url.searchParams.get("channel") || "main");
  if (!channel) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  }
  if (!(await canAccessVideoChannel(channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = Number(session.sub);
  const sortParam = url.searchParams.get("sort") as VideoSort | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : "added";
  const limit = Number(url.searchParams.get("limit") || 60);
  const offset = Number(url.searchParams.get("offset") || 0);

  const videos = listVideos({
    channel,
    userId,
    q: url.searchParams.get("q") || undefined,
    folder: url.searchParams.get("folder") || undefined,
    sort,
    limit: Number.isFinite(limit) ? limit : 60,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return NextResponse.json({
    videos,
    folders: listFolders(channel),
    continueWatching: continueWatching(channel, userId),
    total: countVideos(channel),
  });
}
