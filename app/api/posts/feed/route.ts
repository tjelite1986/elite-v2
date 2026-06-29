import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getShowAdultOutside } from "@/lib/profiles";
import { getFeed, FeedScope } from "@/lib/posts";
import { personContentIds } from "@/lib/profile-links";

// Parse a comma-separated list of positive integer ids from a query param.
function idList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export const dynamic = "force-dynamic";

// Cursor-paginated posts feed. Scope is home (followed authors), explore (all),
// a single user/creator, or a hashtag. Adult posts only appear once the 18+ PIN
// gate is unlocked — re-checked here, never assumed from the page.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const viewerId = Number(session.sub);

  const url = new URL(request.url);
  const kind = url.searchParams.get("scope") || "home";
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 40);

  let scope: FeedScope;
  switch (kind) {
    case "explore":
      scope = { kind: "explore" };
      break;
    case "user":
      scope = { kind: "user", userId: Number(url.searchParams.get("id")) };
      break;
    case "creator":
      scope = { kind: "creator", creatorId: Number(url.searchParams.get("id")) };
      break;
    case "person": {
      // A `handle` expands (server-side) to every linked member's ids; otherwise
      // accept explicit comma-separated userId/creatorId lists (back-compat).
      const handle = url.searchParams.get("handle");
      if (handle) {
        const ids = personContentIds(handle, true);
        scope = { kind: "person", userIds: ids.userIds, creatorIds: ids.creatorIds };
      } else {
        scope = {
          kind: "person",
          userIds: idList(url.searchParams.get("userId")),
          creatorIds: idList(url.searchParams.get("creatorId")),
        };
      }
      break;
    }
    case "tag":
      scope = { kind: "tag", tag: url.searchParams.get("tag") || "" };
      break;
    default:
      scope = { kind: "home" };
  }

  // Adult posts require the PIN. On general surfaces they also require the
  // per-user "show 18+ everywhere" preference; an explicit adult view (adult=1,
  // e.g. a profile's 18+ tab) needs only the PIN.
  const pin = await has18Access();
  const forceAdult = url.searchParams.get("adult") === "1";
  const includeAdult = pin && (forceAdult || getShowAdultOutside(viewerId));
  const { items, nextCursor } = getFeed(
    scope,
    viewerId,
    cursor ? Number(cursor) : null,
    limit,
    includeAdult
  );

  return NextResponse.json({ items, nextCursor });
}
