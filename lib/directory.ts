import { db } from "./db";

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
// to the shared handle namespace.
function handleOf(name: string): string {
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
