import { sql } from "kysely";
import { db } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { getProfileExtras, ProfileLink, ProfileField } from "./profiles";
import { resolveBadges } from "./badges";
import { getPrimaryHandle, personContentIds, getGroupMembers } from "./profile-links";

// A badge as sent to the client — the BadgeDef's `earned` predicate is dropped
// (a function prop would break server→client serialization).
export interface PersonBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  earned_at: string;
}

// Cross-section "people" directory: merges the three identity tables
// (user_profiles, post_creators) by lowercased handle and reports where each
// person has content, so one page links to a person's content across every
// section.
// At a few hundred identities the merge is done in JS each request (sub-ms).

export interface PersonEntry {
  handle: string;
  displayName: string | null;
  userId: number | null; // real app user (vs mirrored creator)
  photos: number; // visible post count (adult filtered unless include18)
  photosHref: string | null;
  hasAvatar: boolean; // any avatar set (handle_avatars or legacy columns)
  /**
   * A creator with a picture or a bio but nothing to show yet — a profile that
   * was saved from the phone before any of its media arrived. Listed, so the
   * saving was not for nothing, but marked so the empty page is expected.
   */
  hasProfileOnly: boolean;
  createdAt: string | null; // when this identity was added (earliest source)
  hasInstagram: boolean; // an Instagram handle is linked (profile_extras)
  hasTiktok: boolean; // a TikTok handle is linked (profile_extras)
}

// Sort order for the /people directory (single choice). "relevance" is the
// default (users first, then most content); the rest are explicit user choices.
export type PeopleSort = "relevance" | "recent" | "name";
export const PEOPLE_SORTS: PeopleSort[] = ["relevance", "recent", "name"];

// Boolean conditions that narrow the list. Multi-select: several combine with
// AND (e.g. "has-instagram" + "no-avatar" = linked-IG people with no picture).
export type PeopleFilter =
  | "no-avatar"
  | "has-instagram"
  | "no-instagram"
  | "has-tiktok"
  | "no-tiktok";
export const PEOPLE_FILTERS: PeopleFilter[] = [
  "no-avatar",
  "has-instagram",
  "no-instagram",
  "has-tiktok",
  "no-tiktok",
];

const FILTER_PREDICATES: Record<PeopleFilter, (p: PersonEntry) => boolean> = {
  "no-avatar": (p) => !p.hasAvatar,
  "has-instagram": (p) => p.hasInstagram,
  "no-instagram": (p) => !p.hasInstagram,
  "has-tiktok": (p) => p.hasTiktok,
  "no-tiktok": (p) => !p.hasTiktok,
};

// The shared handle namespace: every section normalises a name the same way, so
// one person resolves to one page. Exported so section pages can link a creator
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
    hasAvatar: false,
    hasProfileOnly: false,
    createdAt: null,
    hasInstagram: false,
    hasTiktok: false,
  };
}

// Keep the earliest of two "added" timestamps (either may be null/absent).
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export interface ResolvedPerson {
  handle: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  links: ProfileLink[];
  // Custom labeled fields, already filtered to what this viewer may see
  // (private fields are only included for the owner).
  fields: ProfileField[];
  // Auto-earned achievement badges (real users only).
  badges: PersonBadge[];
  hasBanner: boolean;
  // Account join date (users.created_at) for real users; null for mirrored
  // creators with no account.
  memberSince: string | null;
  // Follow counts: followers across all of this person's identities; following
  // is meaningful only for real users (who can follow).
  followers: number;
  following: number;
  userId: number | null; // real user (1:1)
  creatorId: number | null; // photo creator
  isOwn: boolean;
  // Follow target: a person is followed via their user, else photo creator, else
  // null = nothing to follow.
  followType: "user" | "creator" | null;
  followId: number | null;
  viewerFollows: boolean;
  photos: number;
  // Instagram cookie-sync config/status (from profile_extras), keyed by handle.
  instagramHandle: string | null;
  igAutoPoll: boolean;
  igLastSyncedAt: string | null;
  igLastSyncError: string | null;
  igSyncing: boolean;
  // TikTok sync config/status (from profile_extras), keyed by handle.
  tiktokHandle: string | null;
  ttAutoPoll: boolean;
  ttLastSyncedAt: string | null;
  ttLastSyncError: string | null;
  ttSyncing: boolean;
}

// Resolve a handle to its identity across every section, for the unified
// profile page. include18 controls whether adult posts are counted/linked.
export function resolvePerson(
  handle: string,
  viewerId: number,
  include18: boolean
): ResolvedPerson | null {
  // Resolve the requested handle to its primary "face" (if linked), then gather
  // every linked member's content ids so counts/feeds aggregate the whole group.
  const h = getPrimaryHandle(handleOf(handle));
  const ids = personContentIds(h);

  const user = getOne<{
    user_id: number;
    username: string;
    display_name: string | null;
    bio: string | null;
  }>(
    qb
      .selectFrom("user_profiles")
      .select(["user_id", "username", "display_name", "bio"])
      .where("username", "=", h)
  );

  const creator = getOne<{
    id: number;
    username: string;
    display_name: string | null;
    bio: string | null;
  }>(
    qb
      .selectFrom("post_creators")
      .select(["id", "username", "display_name", "bio"])
      .where("username", "=", h)
  );

  if (!user && !creator) {
    return null;
  }

  // Photos across every linked member's user/creator identities.
  const photos =
    ids.userIds.length || ids.creatorIds.length
      ? getOne<{ c: number }>(
          qb
            .selectFrom("posts")
            .select((eb) => eb.fn.countAll<number>().as("c"))
            .where("is_deleted", "=", 0)
            .where((eb) =>
              eb.or(
                [
                  ids.userIds.length
                    ? eb("author_user_id", "in", ids.userIds)
                    : null,
                  ids.creatorIds.length
                    ? eb("author_creator_id", "in", ids.creatorIds)
                    : null,
                ].filter((c): c is NonNullable<typeof c> => c !== null)
              )
            )
        )?.c ?? 0
      : 0;

  // Following state for the primary follow target (user > creator).
  const followType: "user" | "creator" | null = user
    ? "user"
    : creator
      ? "creator"
      : null;
  const followId = user?.user_id ?? creator?.id ?? null;
  const viewerFollows =
    followType !== null &&
    followId !== null &&
    getOne(
      qb
        .selectFrom("follows")
        .select("follower_id")
        .where("follower_id", "=", viewerId)
        .where("target_type", "=", followType)
        .where("target_id", "=", followId)
    ) !== undefined;

  // Handle-scoped extras (bio/links/banner/location) override the legacy bio.
  const extras = getProfileExtras(h);

  // Account join date — only real users have one.
  const memberSince = user
    ? getOne<{ created_at: string }>(
        qb.selectFrom("users").select("created_at").where("id", "=", user.user_id)
      )?.created_at ?? null
    : null;

  // Followers: anyone following any of this person's identities. Following: only
  // real users follow others.
  const countFollowers = (type: "user" | "creator", id: number): number =>
    getOne<{ c: number }>(
      qb
        .selectFrom("follows")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .where("target_type", "=", type)
        .where("target_id", "=", id)
    )?.c ?? 0;
  let followers = 0;
  for (const uid of ids.userIds) followers += countFollowers("user", uid);
  for (const cid of ids.creatorIds) followers += countFollowers("creator", cid);
  const following = user
    ? getOne<{ c: number }>(
        qb
          .selectFrom("follows")
          .select((eb) => eb.fn.countAll<number>().as("c"))
          .where("follower_id", "=", user.user_id)
      )?.c ?? 0
    : 0;

  const isOwn = user?.user_id === viewerId;
  return {
    handle: user?.username || creator?.username || h,
    displayName: user?.display_name || creator?.display_name || null,
    bio: extras?.bio || user?.bio || creator?.bio || null,
    location: extras?.location ?? null,
    links: extras?.links ?? [],
    // Owner sees all custom fields; everyone else sees only the public ones.
    fields: (extras?.fields ?? []).filter((f) => f.public || isOwn),
    badges: user
      ? resolveBadges(user.user_id).map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          icon: b.icon,
          color: b.color,
          earned_at: b.earned_at,
        }))
      : [],
    hasBanner: Boolean(extras?.banner_key),
    memberSince,
    followers,
    following,
    userId: user?.user_id ?? null,
    creatorId: creator?.id ?? null,
    isOwn,
    followType,
    followId,
    viewerFollows,
    photos,
    instagramHandle: extras?.instagramHandle ?? null,
    igAutoPoll: extras?.igAutoPoll ?? false,
    igLastSyncedAt: extras?.igLastSyncedAt ?? null,
    igLastSyncError: extras?.igLastSyncError ?? null,
    igSyncing: extras?.igSyncing ?? false,
    tiktokHandle: extras?.tiktokHandle ?? null,
    ttAutoPoll: extras?.ttAutoPoll ?? false,
    ttLastSyncedAt: extras?.ttLastSyncedAt ?? null,
    ttLastSyncError: extras?.ttLastSyncError ?? null,
    ttSyncing: extras?.ttSyncing ?? false,
  };
}

export function getPeople(
  opts: {
    q?: string;
    include18?: boolean;
    sort?: PeopleSort;
    filters?: PeopleFilter[];
  } = {}
): PersonEntry[] {
  const include18 = Boolean(opts.include18);
  const sort: PeopleSort = opts.sort || "relevance";
  const filters = opts.filters || [];
  const people = new Map<string, PersonEntry>();

  // Handles that have a chosen avatar (handle_avatars takes precedence over the
  // legacy per-table avatar_key columns). Loaded once so "no avatar" sorting and
  // the hasAvatar flag don't need a per-person query.
  const avatarHandles = new Set(
    getAll<{ handle: string }>(qb.selectFrom("handle_avatars").select("handle")).map(
      (r) => r.handle
    )
  );

  // Linked social accounts (Instagram / TikTok) live on profile_extras, keyed by
  // the same lowercased handle. Loaded once so the has/missing sorts don't need a
  // per-person query. A non-empty handle counts as "linked".
  const socialByHandle = new Map(
    getAll<{
      handle: string;
      instagram_handle: string | null;
      tiktok_handle: string | null;
    }>(
      qb
        .selectFrom("profile_extras")
        .select(["handle", "instagram_handle", "tiktok_handle"])
    ).map((r) => [
      r.handle,
      {
        hasInstagram: Boolean(r.instagram_handle && r.instagram_handle.trim()),
        hasTiktok: Boolean(r.tiktok_handle && r.tiktok_handle.trim()),
      },
    ])
  );
  const get = (handle: string) => {
    let p = people.get(handle);
    if (!p) {
      p = blank(handle);
      people.set(handle, p);
    }
    return p;
  };

  // 18+ posts are excluded from counts unless include18 (decided at build time).
  const adultFilter = include18 ? sql`` : sql` AND p.is_adult = 0`;

  // Real users — always listed, photo count = their own posts.
  const users = getAll<{
    user_id: number;
    username: string;
    display_name: string | null;
    avatar_key: string | null;
    bio: string | null;
    created_at: string | null;
    photos: number;
  }>(
    qb
      .selectFrom("user_profiles as up")
      .select([
        "up.user_id",
        "up.username",
        "up.display_name",
        "up.avatar_key",
        "up.created_at",
        sql<number>`(SELECT COUNT(*) FROM posts p WHERE p.author_user_id = up.user_id AND p.is_deleted = 0${adultFilter})`.as(
          "photos"
        ),
      ])
  );
  for (const u of users) {
    const p = get(handleOf(u.username));
    p.handle = u.username;
    p.displayName = u.display_name;
    p.userId = u.user_id;
    p.photos += u.photos;
    p.photosHref = `/posts/u/${u.username}`;
    if (u.avatar_key) p.hasAvatar = true;
    p.createdAt = earliest(p.createdAt, u.created_at);
  }

  // Mirrored photo creators.
  const creators = getAll<{
    username: string;
    display_name: string | null;
    avatar_key: string | null;
    bio: string | null;
    created_at: string | null;
    photos: number;
  }>(
    qb
      .selectFrom("post_creators as pc")
      .select([
        "pc.username",
        "pc.display_name",
        "pc.avatar_key",
        "pc.bio",
        "pc.created_at",
        sql<number>`(SELECT COUNT(*) FROM posts p WHERE p.author_creator_id = pc.id AND p.is_deleted = 0${adultFilter})`.as(
          "photos"
        ),
      ])
  );
  for (const c of creators) {
    const p = get(handleOf(c.username));
    if (c.avatar_key) p.hasAvatar = true;
    if (c.bio && c.bio.trim()) p.hasProfileOnly = true;
    p.createdAt = earliest(p.createdAt, c.created_at);
    if (!p.userId) {
      if (!p.displayName) p.displayName = c.display_name;
      p.photos += c.photos;
      if (c.photos > 0) p.photosHref = `/posts/u/${c.username}`;
    }
  }

  // Linked-social flags per handle, set before the collapse so a linked member's
  // Instagram/TikTok is folded into the primary "face" below.
  for (const [key, entry] of Array.from(people.entries())) {
    const social = socialByHandle.get(key);
    if (social) {
      if (social.hasInstagram) entry.hasInstagram = true;
      if (social.hasTiktok) entry.hasTiktok = true;
    }
  }

  // A chosen handle avatar (handle_avatars) wins over the legacy columns —
  // applied BEFORE the collapse (like the social flags above) so a member's
  // chosen avatar also counts for its primary "face".
  for (const [key, entry] of Array.from(people.entries())) {
    if (avatarHandles.has(key)) entry.hasAvatar = true;
  }

  // Collapse non-destructively linked members into their primary "face": fold
  // their counts/ids into the primary entry and drop the member from the list.
  for (const [key, entry] of Array.from(people.entries())) {
    const primary = getPrimaryHandle(key);
    if (primary === key) continue;
    const target = get(primary);
    target.photos += entry.photos;
    if (target.userId === null && entry.userId !== null) target.userId = entry.userId;
    if (!target.displayName && entry.displayName) target.displayName = entry.displayName;
    if (!target.photosHref && entry.photosHref) target.photosHref = entry.photosHref;
    if (entry.hasAvatar) target.hasAvatar = true;
    if (entry.hasInstagram) target.hasInstagram = true;
    if (entry.hasTiktok) target.hasTiktok = true;
    target.createdAt = earliest(target.createdAt, entry.createdAt);
    people.delete(key);
  }

  // Filter: keep real users always; a mirrored creator when it has visible
  // content — or when someone deliberately gave it a face or a bio. A profile
  // saved from the phone before its media arrived is exactly that case, and
  // hiding it made the saving look like it had failed. `hasProfileOnly` is left
  // set only while there is nothing to show, so the mark disappears by itself
  // once the first post lands.
  let list = Array.from(people.values()).filter((p) => {
    const visible =
      p.photos > 0;
    if (visible) p.hasProfileOnly = false;
    else if (p.hasAvatar) p.hasProfileOnly = true;
    return p.userId !== null || visible || p.hasProfileOnly;
  });

  const q = (opts.q || "").trim().toLowerCase();
  if (q) {
    list = list.filter(
      (p) =>
        p.handle.toLowerCase().includes(q) ||
        (p.displayName || "").toLowerCase().includes(q)
    );
  }

  // Multi-select conditions: every selected filter must match (AND).
  for (const f of filters) {
    const pred = FILTER_PREDICATES[f];
    if (pred) list = list.filter(pred);
  }

  const byName = (a: PersonEntry, b: PersonEntry) =>
    (a.displayName || a.handle).localeCompare(b.displayName || b.handle);

  if (sort === "name") {
    list.sort(byName);
  } else if (sort === "recent") {
    // Most recently added first; unknown dates sort last, then by name.
    list.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      }
      return byName(a, b);
    });
  } else {
    // relevance (default): users first, then by total visible content desc, then handle.
    list.sort((a, b) => {
      if ((b.userId !== null ? 1 : 0) !== (a.userId !== null ? 1 : 0)) {
        return (b.userId !== null ? 1 : 0) - (a.userId !== null ? 1 : 0);
      }
      const at = a.photos;
      const bt = b.photos;
      if (bt !== at) return bt - at;
      return a.handle.localeCompare(b.handle);
    });
  }

  return list;
}

// Which of these handles this library actually hosts, as a lowercased set. Used
// to decide whether an @mention in a bio links to a local profile or out to
// Instagram: a bio names Instagram accounts, and most are not people we host.
export function knownHandles(handles: string[]): Set<string> {
  const wanted = Array.from(new Set(handles.map((h) => handleOf(h)))).filter(Boolean);
  if (wanted.length === 0) return new Set();
  const placeholders = wanted.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT lower(username) AS handle FROM user_profiles WHERE lower(username) IN (${placeholders})
       UNION
       SELECT lower(username) AS handle FROM post_creators WHERE lower(username) IN (${placeholders})`
    )
    .all(...wanted, ...wanted) as { handle: string }[];
  return new Set(rows.map((r) => r.handle));
}

// The @handles written in a bio, in the same shape BioText matches them.
export function mentionsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(/@([a-zA-Z0-9_.]{1,30})/g)).map((m) =>
    m[1].replace(/\.+$/, "").toLowerCase()
  );
}

// Local hrefs for the @mentions in a bio, keyed by lowercased handle. Handles we
// do not host are left out, and BioText sends those to Instagram instead.
export function bioMentionHrefs(bio: string | null | undefined): Record<string, string> {
  const handles = mentionsIn(bio);
  if (handles.length === 0) return {};
  const known = knownHandles(handles);
  const out: Record<string, string> = {};
  for (const handle of handles) {
    if (known.has(handle)) out[handle] = `/people/${encodeURIComponent(handle)}`;
  }
  return out;
}
