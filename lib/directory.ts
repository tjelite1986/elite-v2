import { db } from "./db";
import { getProfileExtras, ProfileLink } from "./profiles";

// Cross-section "people" directory: merges the three identity tables
// (user_profiles, post_creators, short_profiles) by lowercased handle and
// reports where each person has content — Photos (posts), Shorts (main),
// Shorts 18+ — so one page links to a person's content across every section.
// At a few hundred identities the merge is done in JS each request (sub-ms).

export interface PersonEntry {
  handle: string;
  displayName: string | null;
  userId: number | null; // real app user (vs mirrored creator)
  photos: number; // visible post count (adult filtered unless include18)
  photosHref: string | null;
  shortsMain: number;
  shortsMainId: number | null;
  shorts18: number;
  shorts18Id: number | null;
}

// Same slug rule used for short_profiles names elsewhere, so a clip creator maps
// to the shared handle namespace. Exported so shorts pages can link a creator
// name to its unified /people profile.
export function handleOf(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

function blank(handle: string): PersonEntry {
  return {
    handle,
    displayName: null,
    userId: null,
    photos: 0,
    photosHref: null,
    shortsMain: 0,
    shortsMainId: null,
    shorts18: 0,
    shorts18Id: null,
  };
}

export interface ResolvedPerson {
  handle: string;
  displayName: string | null;
  bio: string | null;
  links: ProfileLink[];
  hasBanner: boolean;
  userId: number | null; // real user (1:1)
  creatorId: number | null; // photo creator
  isOwn: boolean;
  // Follow target: a person is followed via their user, else photo creator, else
  // (video-only creators) one of their shorts profiles. null = nothing to follow.
  followType: "user" | "creator" | "shorts" | null;
  followId: number | null;
  viewerFollows: boolean;
  photos: number;
  shortsMainId: number | null;
  shortsMain: number;
  shortsMainAutoPoll: boolean;
  shortsMainPollable: boolean;
  shorts18Id: number | null;
  shorts18: number;
  shorts18AutoPoll: boolean;
  shorts18Pollable: boolean;
}

// Resolve a handle to its identity across every section, for the unified
// profile page. include18 controls whether 18+ shorts are counted/linked.
export function resolvePerson(
  handle: string,
  viewerId: number,
  include18: boolean
): ResolvedPerson | null {
  const h = handleOf(handle);

  const user = db
    .prepare(
      "SELECT user_id, username, display_name, bio FROM user_profiles WHERE username = ?"
    )
    .get(h) as
    | { user_id: number; username: string; display_name: string | null; bio: string | null }
    | undefined;

  const creator = db
    .prepare(
      "SELECT id, username, display_name, bio FROM post_creators WHERE username = ?"
    )
    .get(h) as
    | { id: number; username: string; display_name: string | null; bio: string | null }
    | undefined;

  const shorts = db
    .prepare(
      "SELECT id, name, channel, auto_poll, source_type, source_ref FROM short_profiles"
    )
    .all() as {
    id: number;
    name: string;
    channel: string;
    auto_poll: number;
    source_type: string;
    source_ref: string;
  }[];
  let shortsMainId: number | null = null;
  let shorts18Id: number | null = null;
  // Poll/download settings make sense only for a pollable source (not 'manual').
  const pollOf = (s: { source_type: string; source_ref: string }) =>
    s.source_type !== "manual" && Boolean(s.source_ref);
  let shortsMainAutoPoll = false;
  let shorts18AutoPoll = false;
  let shortsMainPollable = false;
  let shorts18Pollable = false;
  for (const s of shorts) {
    if (handleOf(s.name) !== h) continue;
    if (s.channel === "18plus") {
      shorts18Id = s.id;
      shorts18AutoPoll = Boolean(s.auto_poll);
      shorts18Pollable = pollOf(s);
    } else {
      shortsMainId = s.id;
      shortsMainAutoPoll = Boolean(s.auto_poll);
      shortsMainPollable = pollOf(s);
    }
  }

  if (!user && !creator && shortsMainId === null && shorts18Id === null) {
    return null;
  }

  const count = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...args) as { c: number }).c;

  const photos =
    (user ? count("SELECT COUNT(*) c FROM posts WHERE author_user_id = ? AND is_deleted = 0", user.user_id) : 0) +
    (creator ? count("SELECT COUNT(*) c FROM posts WHERE author_creator_id = ? AND is_deleted = 0", creator.id) : 0);

  const clipCount = (id: number | null) =>
    id === null
      ? 0
      : count(
          "SELECT COUNT(*) c FROM shorts WHERE profile_id = ? AND is_deleted = 0 AND status = 'ready'",
          id
        );

  // Following state for the primary follow target (user > creator > shorts, so a
  // video-only creator is still followable).
  const shortsFollowId = shortsMainId ?? shorts18Id;
  const followType: "user" | "creator" | "shorts" | null = user
    ? "user"
    : creator
      ? "creator"
      : shortsFollowId !== null
        ? "shorts"
        : null;
  const followId = user?.user_id ?? creator?.id ?? shortsFollowId ?? null;
  const viewerFollows =
    followType !== null &&
    followId !== null &&
    Boolean(
      db
        .prepare(
          "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?"
        )
        .get(viewerId, followType, followId)
    );

  // Handle-scoped extras (bio/links/banner) override the legacy per-table bio.
  const extras = getProfileExtras(h);

  return {
    handle: user?.username || creator?.username || h,
    displayName: user?.display_name || creator?.display_name || null,
    bio: extras?.bio || user?.bio || creator?.bio || null,
    links: extras?.links ?? [],
    hasBanner: Boolean(extras?.banner_key),
    userId: user?.user_id ?? null,
    creatorId: creator?.id ?? null,
    isOwn: user?.user_id === viewerId,
    followType,
    followId,
    viewerFollows,
    photos,
    shortsMainId,
    shortsMain: clipCount(shortsMainId),
    shortsMainAutoPoll,
    shortsMainPollable,
    shorts18Id: include18 ? shorts18Id : null,
    shorts18: include18 ? clipCount(shorts18Id) : 0,
    shorts18AutoPoll: include18 ? shorts18AutoPoll : false,
    shorts18Pollable: include18 ? shorts18Pollable : false,
  };
}

export function getPeople(
  opts: { q?: string; include18?: boolean } = {}
): PersonEntry[] {
  const include18 = Boolean(opts.include18);
  const people = new Map<string, PersonEntry>();
  const get = (handle: string) => {
    let p = people.get(handle);
    if (!p) {
      p = blank(handle);
      people.set(handle, p);
    }
    return p;
  };

  // Real users — always listed, photo count = their own posts.
  const users = db
    .prepare(
      `SELECT up.user_id, up.username, up.display_name,
              (SELECT COUNT(*) FROM posts p
                WHERE p.author_user_id = up.user_id AND p.is_deleted = 0
                  AND (@include18 = 1 OR p.is_adult = 0)) AS photos
         FROM user_profiles up`
    )
    .all({ include18: include18 ? 1 : 0 }) as {
    user_id: number;
    username: string;
    display_name: string | null;
    photos: number;
  }[];
  for (const u of users) {
    const p = get(handleOf(u.username));
    p.handle = u.username;
    p.displayName = u.display_name;
    p.userId = u.user_id;
    p.photos += u.photos;
    p.photosHref = `/posts/u/${u.username}`;
  }

  // Mirrored photo creators.
  const creators = db
    .prepare(
      `SELECT pc.username, pc.display_name,
              (SELECT COUNT(*) FROM posts p
                WHERE p.author_creator_id = pc.id AND p.is_deleted = 0
                  AND (@include18 = 1 OR p.is_adult = 0)) AS photos
         FROM post_creators pc`
    )
    .all({ include18: include18 ? 1 : 0 }) as {
    username: string;
    display_name: string | null;
    photos: number;
  }[];
  for (const c of creators) {
    const p = get(handleOf(c.username));
    if (!p.userId) {
      if (!p.displayName) p.displayName = c.display_name;
      p.photos += c.photos;
      if (c.photos > 0) p.photosHref = `/posts/u/${c.username}`;
    }
  }

  // Mirrored video creators (shorts), split by channel.
  const shorts = db
    .prepare(
      `SELECT sp.id, sp.name, sp.channel,
              (SELECT COUNT(*) FROM shorts s
                WHERE s.profile_id = sp.id AND s.is_deleted = 0 AND s.status = 'ready') AS clips
         FROM short_profiles sp`
    )
    .all() as { id: number; name: string; channel: string; clips: number }[];
  for (const s of shorts) {
    const p = get(handleOf(s.name));
    if (!p.displayName) p.displayName = s.name;
    if (s.channel === "18plus") {
      // Only surface 18+ counts/links when the viewer may see adult content.
      if (!include18) continue;
      p.shorts18 += s.clips;
      if (s.clips > 0) p.shorts18Id = s.id;
    } else {
      p.shortsMain += s.clips;
      if (s.clips > 0) p.shortsMainId = s.id;
    }
  }

  // Filter: keep real users always; mirrored creators only when they have
  // visible content in some section.
  let list = Array.from(people.values()).filter((p) => {
    const visible =
      p.photos > 0 || p.shortsMain > 0 || (include18 && p.shorts18 > 0);
    return p.userId !== null || visible;
  });

  const q = (opts.q || "").trim().toLowerCase();
  if (q) {
    list = list.filter(
      (p) =>
        p.handle.toLowerCase().includes(q) ||
        (p.displayName || "").toLowerCase().includes(q)
    );
  }

  // Users first, then by total visible content desc, then handle.
  list.sort((a, b) => {
    if ((b.userId !== null ? 1 : 0) !== (a.userId !== null ? 1 : 0)) {
      return (b.userId !== null ? 1 : 0) - (a.userId !== null ? 1 : 0);
    }
    const at = a.photos + a.shortsMain + (include18 ? a.shorts18 : 0);
    const bt = b.photos + b.shortsMain + (include18 ? b.shorts18 : 0);
    if (bt !== at) return bt - at;
    return a.handle.localeCompare(b.handle);
  });

  return list;
}
