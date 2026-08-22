// Global full-text search across the content types a viewer may see. FTS5
// MATCH cannot be expressed through Kysely (virtual tables are not in the
// schema), so this module queries the raw better-sqlite3 handle directly and
// falls back to LIKE when the SQLite build lacks FTS5.

import { db } from "./db";
import { handleOf } from "./directory";

export type SearchViewer = { userId: number; isAdmin: boolean; adult: boolean };

export type SearchResults = {
  people: { username: string; display_name: string | null; type: "user" | "creator" }[];
  posts: { id: number; snippet: string; author: string | null; created_at: string }[];
  messages: { id: number; snippet: string; peer: string; created_at: string }[];
  channelMessages: { id: number; snippet: string; channel: string; sender: string; created_at: string }[];
  gallery: { id: number; filename: string; snippet: string }[];
  shorts: { id: number; snippet: string; profile: string | null; channel: string }[];
  // `snippet` is the video title, carrying [match] markers like the other
  // sections so the client highlights it the same way.
  videos: {
    id: number;
    snippet: string;
    folder: string;
    channel: string;
    duration: number | null;
  }[];
  books: { slug: string; title: string; author: string | null }[];
};

const LIMIT = 10;

function hasFts(table: string): boolean {
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    return !!row;
  } catch {
    return false;
  }
}

// Turn free text into a safe FTS5 query: each token quoted (so operators like
// NEAR/AND/- lose their meaning), the last one as a prefix so typing feels
// incremental ("summer vaca" matches "vacation").
function ftsQuery(q: string): string | null {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(" ");
}

function likePattern(q: string): string {
  return `%${q.replace(/[%_]/g, "")}%`;
}

function searchPeople(q: string, viewer: SearchViewer): SearchResults["people"] {
  const like = likePattern(q.toLowerCase());
  const users = db
    .prepare(
      `SELECT username, display_name FROM user_profiles
        WHERE username LIKE ? OR LOWER(display_name) LIKE ?
        ORDER BY username LIMIT ?`
    )
    .all(like, like, LIMIT) as { username: string; display_name: string | null }[];
  const creators = db
    .prepare(
      `SELECT username, display_name FROM post_creators
        WHERE (username LIKE ? OR LOWER(display_name) LIKE ?)${viewer.adult ? "" : " AND is_adult = 0"}
        ORDER BY username LIMIT ?`
    )
    .all(like, like, LIMIT) as { username: string; display_name: string | null }[];
  const shortProfiles = db
    .prepare(
      `SELECT DISTINCT name FROM short_profiles
        WHERE LOWER(name) LIKE ?${viewer.adult ? "" : " AND channel = 'main'"}
        ORDER BY name LIMIT ?`
    )
    .all(like, LIMIT) as { name: string }[];

  const byHandle = new Map<string, SearchResults["people"][number]>();
  const add = (username: string, display_name: string | null, type: "user" | "creator") => {
    const h = handleOf(username);
    if (h && !byHandle.has(h)) byHandle.set(h, { username, display_name, type });
  };
  for (const u of users) add(u.username, u.display_name, "user");
  for (const c of creators) add(c.username, c.display_name, "creator");
  for (const s of shortProfiles) add(handleOf(s.name), s.name, "creator");
  return Array.from(byHandle.values()).slice(0, LIMIT);
}

function searchPosts(match: string | null, q: string, viewer: SearchViewer): SearchResults["posts"] {
  const adultFilter = viewer.adult ? "" : " AND p.is_adult = 0";
  if (match && hasFts("posts_fts")) {
    return db
      .prepare(
        `SELECT p.id, snippet(posts_fts, 0, '[', ']', '…', 12) AS snippet, p.created_at,
                COALESCE(pc.username, up.username) AS author
           FROM posts_fts
           JOIN posts p ON p.id = posts_fts.rowid
           LEFT JOIN post_creators pc ON pc.id = p.author_creator_id
           LEFT JOIN user_profiles up ON up.user_id = p.author_user_id
          WHERE posts_fts MATCH ? AND p.is_deleted = 0${adultFilter}
          ORDER BY rank LIMIT ?`
      )
      .all(match, LIMIT) as SearchResults["posts"];
  }
  return db
    .prepare(
      `SELECT p.id, substr(p.caption, 1, 120) AS snippet, p.created_at,
              COALESCE(pc.username, up.username) AS author
         FROM posts p
         LEFT JOIN post_creators pc ON pc.id = p.author_creator_id
         LEFT JOIN user_profiles up ON up.user_id = p.author_user_id
        WHERE p.caption LIKE ? AND p.is_deleted = 0${adultFilter}
        ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(likePattern(q), LIMIT) as SearchResults["posts"];
}

function searchMessages(match: string | null, q: string, viewer: SearchViewer): SearchResults["messages"] {
  const base = `
    JOIN user_profiles su ON su.user_id = m.sender_id
    JOIN user_profiles ru ON ru.user_id = m.recipient_id
    WHERE %MATCH% m.deleted_at IS NULL AND (m.sender_id = @me OR m.recipient_id = @me)`;
  const select = `SELECT m.id, %SNIPPET% AS snippet, m.created_at,
    CASE WHEN m.sender_id = @me THEN ru.username ELSE su.username END AS peer`;
  if (match && hasFts("messages_fts")) {
    return db
      .prepare(
        `${select.replace("%SNIPPET%", "snippet(messages_fts, 0, '[', ']', '…', 12)")}
           FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
           ${base.replace("%MATCH%", "messages_fts MATCH @q AND")}
          ORDER BY rank LIMIT ${LIMIT}`
      )
      .all({ q: match, me: viewer.userId }) as SearchResults["messages"];
  }
  return db
    .prepare(
      `${select.replace("%SNIPPET%", "substr(m.body, 1, 120)")}
         FROM messages m
         ${base.replace("%MATCH%", "m.body LIKE @q AND")}
        ORDER BY m.created_at DESC LIMIT ${LIMIT}`
    )
    .all({ q: likePattern(q), me: viewer.userId }) as SearchResults["messages"];
}

function searchChannelMessages(
  match: string | null,
  q: string,
  viewer: SearchViewer
): SearchResults["channelMessages"] {
  const base = `
    JOIN channel_members mem ON mem.channel_id = m.channel_id AND mem.user_id = @me
    JOIN channels c ON c.id = m.channel_id
    JOIN user_profiles su ON su.user_id = m.sender_id
    WHERE %MATCH% m.deleted_at IS NULL`;
  const select = `SELECT m.id, %SNIPPET% AS snippet, m.created_at, c.name AS channel, su.username AS sender`;
  if (match && hasFts("channel_messages_fts")) {
    return db
      .prepare(
        `${select.replace("%SNIPPET%", "snippet(channel_messages_fts, 0, '[', ']', '…', 12)")}
           FROM channel_messages_fts JOIN channel_messages m ON m.id = channel_messages_fts.rowid
           ${base.replace("%MATCH%", "channel_messages_fts MATCH @q AND")}
          ORDER BY rank LIMIT ${LIMIT}`
      )
      .all({ q: match, me: viewer.userId }) as SearchResults["channelMessages"];
  }
  return db
    .prepare(
      `${select.replace("%SNIPPET%", "substr(m.body, 1, 120)")}
         FROM channel_messages m
         ${base.replace("%MATCH%", "m.body LIKE @q AND")}
        ORDER BY m.created_at DESC LIMIT ${LIMIT}`
    )
    .all({ q: likePattern(q), me: viewer.userId }) as SearchResults["channelMessages"];
}

function searchGallery(match: string | null, q: string, viewer: SearchViewer): SearchResults["gallery"] {
  if (match && hasFts("gallery_fts")) {
    return db
      .prepare(
        `SELECT g.id, g.filename, snippet(gallery_fts, 1, '[', ']', '…', 12) AS snippet
           FROM gallery_fts JOIN gallery_items g ON g.id = gallery_fts.rowid
          WHERE gallery_fts MATCH ? AND g.user_id = ? AND g.is_deleted = 0
          ORDER BY rank LIMIT ?`
      )
      .all(match, viewer.userId, LIMIT) as SearchResults["gallery"];
  }
  const like = likePattern(q);
  return db
    .prepare(
      `SELECT id, filename, COALESCE(substr(description, 1, 120), '') AS snippet
         FROM gallery_items
        WHERE (filename LIKE ? OR description LIKE ? OR location_name LIKE ?)
          AND user_id = ? AND is_deleted = 0
        ORDER BY taken_at DESC LIMIT ?`
    )
    .all(like, like, like, viewer.userId, LIMIT) as SearchResults["gallery"];
}

function searchShorts(match: string | null, q: string, viewer: SearchViewer): SearchResults["shorts"] {
  const guards = `s.is_deleted = 0 AND s.status = 'ready'
    AND (s.is_private = 0 OR s.uploader_id = @me OR @isAdmin)
    ${viewer.adult ? "" : "AND s.channel = 'main'"}`;
  const isAdmin = viewer.isAdmin ? 1 : 0;
  if (match && hasFts("shorts_fts")) {
    return db
      .prepare(
        `SELECT s.id, snippet(shorts_fts, 0, '[', ']', '…', 12) AS snippet, s.channel,
                sp.name AS profile
           FROM shorts_fts JOIN shorts s ON s.id = shorts_fts.rowid
           LEFT JOIN short_profiles sp ON sp.id = s.profile_id
          WHERE shorts_fts MATCH @q AND ${guards}
          ORDER BY rank LIMIT ${LIMIT}`
      )
      .all({ q: match, me: viewer.userId, isAdmin }) as SearchResults["shorts"];
  }
  return db
    .prepare(
      `SELECT s.id, substr(s.caption, 1, 120) AS snippet, s.channel, sp.name AS profile
         FROM shorts s
         LEFT JOIN short_profiles sp ON sp.id = s.profile_id
        WHERE s.caption LIKE @q AND ${guards}
        ORDER BY s.id DESC LIMIT ${LIMIT}`
    )
    .all({ q: likePattern(q), me: viewer.userId, isAdmin }) as SearchResults["shorts"];
}

// Long-form video library. Shared (no per-user scoping), but the adults channel
// is only searchable once the 18+ gate is satisfied — otherwise a title would
// leak through search even though the section itself is locked.
function searchVideos(
  match: string | null,
  q: string,
  viewer: SearchViewer
): SearchResults["videos"] {
  const adultFilter = viewer.adult ? "" : " AND v.channel = 'main'";
  if (match && hasFts("videos_fts")) {
    return db
      .prepare(
        `SELECT v.id, snippet(videos_fts, 0, '[', ']', '…', 12) AS snippet,
                v.folder, v.channel, v.duration
           FROM videos_fts JOIN videos v ON v.id = videos_fts.rowid
          WHERE videos_fts MATCH ?${adultFilter}
          ORDER BY rank LIMIT ?`
      )
      .all(match, LIMIT) as SearchResults["videos"];
  }
  const like = likePattern(q);
  return db
    .prepare(
      `SELECT id, title AS snippet, folder, channel, duration
         FROM videos v
        WHERE (v.title LIKE ? OR v.description LIKE ? OR v.folder LIKE ?)${adultFilter}
        ORDER BY v.added_at DESC LIMIT ?`
    )
    .all(like, like, like, LIMIT) as SearchResults["videos"];
}

function searchBooks(q: string): SearchResults["books"] {
  const like = likePattern(q.toLowerCase());
  return db
    .prepare(
      `SELECT slug, title, author FROM books
        WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ?
        ORDER BY title LIMIT ?`
    )
    .all(like, like, LIMIT) as SearchResults["books"];
}

export function globalSearch(q: string, viewer: SearchViewer): SearchResults {
  const match = ftsQuery(q);
  return {
    people: searchPeople(q, viewer),
    posts: searchPosts(match, q, viewer),
    messages: searchMessages(match, q, viewer),
    channelMessages: searchChannelMessages(match, q, viewer),
    gallery: searchGallery(match, q, viewer),
    shorts: searchShorts(match, q, viewer),
    videos: searchVideos(match, q, viewer),
    books: searchBooks(q),
  };
}
