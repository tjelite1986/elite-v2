import { NextResponse } from "next/server";
import path from "node:path";
import { db, ShortRow, PostMediaRow, GalleryItemRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseHashtags } from "@/lib/posts";
import { getShort } from "@/lib/shorts";
import { canonicalStem } from "@/lib/import-naming";
import { renameShortFiles } from "@/lib/shorts-storage";
import { renamePostImageFiles } from "@/lib/posts-storage";
import { renameGalleryFiles } from "@/lib/gallery-storage";
import { setItemTags } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

type Section = "shorts" | "shorts18" | "posts" | "gallery";
const SECTIONS: Section[] = ["shorts", "shorts18", "posts", "gallery"];
const channelFor = (s: Section) => (s === "shorts18" ? "18plus" : "main");

// Normalize a free-form tag input (array of words or a "#a #b" / "a, b" string)
// into the same canonical hashtag list the importer/caption parser produces.
function normTags(raw: unknown): string[] {
  const tokens = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\s,]+/);
  const joined = tokens
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
  return parseHashtags(joined);
}

// Build a human caption that also embeds the hashtags, so the caption and the
// filename stem carry the same metadata.
function buildCaption(title: string, hashtags: string[]): string | null {
  const tags = hashtags.map((t) => `#${t}`).join(" ");
  return [title.trim(), tags].filter(Boolean).join(" ").trim() || null;
}

// GET /api/rename?section=...&q=...
// List candidate items to rename (own items; admins see all). Returns the
// current title/filename so the user can spot junk-named files to fix.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  const userId = Number(session.sub);

  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") as Section | null;
  if (!section || !SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Invalid section." }, { status: 400 });
  }
  const q = (searchParams.get("q") ?? "").trim();
  const like = `%${q}%`;

  let rows: { id: number; title: string }[] = [];
  if (section === "gallery") {
    rows = db
      .prepare(
        `SELECT id, filename AS title FROM gallery_items
         WHERE is_deleted = 0 ${isAdmin ? "" : "AND user_id = @userId"}
         ${q ? "AND filename LIKE @like" : ""}
         ORDER BY id DESC LIMIT 60`
      )
      .all({ userId, like }) as { id: number; title: string }[];
  } else if (section === "posts") {
    rows = db
      .prepare(
        `SELECT id, COALESCE(caption, '') AS title FROM posts
         WHERE is_deleted = 0 ${isAdmin ? "" : "AND author_user_id = @userId"}
         ${q ? "AND caption LIKE @like" : ""}
         ORDER BY id DESC LIMIT 60`
      )
      .all({ userId, like }) as { id: number; title: string }[];
  } else {
    rows = db
      .prepare(
        `SELECT id, COALESCE(caption, '') AS title FROM shorts
         WHERE is_deleted = 0 AND channel = @channel
         ${isAdmin ? "" : "AND uploader_id = @userId"}
         ${q ? "AND caption LIKE @like" : ""}
         ORDER BY id DESC LIMIT 60`
      )
      .all({ userId, like, channel: channelFor(section) }) as {
      id: number;
      title: string;
    }[];
  }
  return NextResponse.json({ items: rows });
}

// POST /api/rename  { section, id, title, tags }
// Re-title a single media item and add/replace its hashtags. The on-disk file is
// renamed to a canonical, self-describing basename so it is findable in the
// folder and still round-trips through the importer.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const section = body?.section as Section;
  const id = Number(body?.id);
  if (!SECTIONS.includes(section) || !Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const title = String(body?.title ?? "").trim();
  const hashtags = normTags(body?.tags);
  const meta = { title, hashtags, collection: null, siteId: null };

  try {
    if (section === "gallery") {
      const item = db
        .prepare("SELECT * FROM gallery_items WHERE id = ?")
        .get(id) as GalleryItemRow | undefined;
      if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (item.user_id !== userId && !isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const newStem = canonicalStem(meta, item.id);
      const newKey = renameGalleryFiles(item.user_id, item.storage_key, newStem);
      db.prepare(
        `UPDATE gallery_items
         SET storage_key = ?, filename = ?, media_version = media_version + 1
         WHERE id = ?`
      ).run(newKey, path.basename(newKey), item.id);
      setItemTags(item.user_id, item.id, hashtags);
      return NextResponse.json({ ok: true, storage_key: newKey });
    }

    if (section === "posts") {
      const post = db
        .prepare("SELECT id, author_user_id FROM posts WHERE id = ? AND is_deleted = 0")
        .get(id) as { id: number; author_user_id: number | null } | undefined;
      if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (post.author_user_id !== userId && !isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const media = db
        .prepare("SELECT * FROM post_media WHERE post_id = ? ORDER BY position")
        .all(post.id) as PostMediaRow[];
      const caption = buildCaption(title, hashtags);
      db.transaction(() => {
        db.prepare("UPDATE posts SET caption = ? WHERE id = ?").run(caption, post.id);
        db.prepare("DELETE FROM post_hashtags WHERE post_id = ?").run(post.id);
        const insertTag = db.prepare(
          "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
        );
        for (const tag of hashtags) insertTag.run(post.id, tag);
        for (const m of media) {
          const newKey = renamePostImageFiles(m.storage_key, canonicalStem(meta, m.id));
          db.prepare(
            "UPDATE post_media SET storage_key = ?, media_version = media_version + 1 WHERE id = ?"
          ).run(newKey, m.id);
        }
      })();
      return NextResponse.json({ ok: true, caption });
    }

    // shorts / shorts18
    const channel = channelFor(section);
    const short = getShort(id) as ShortRow | undefined;
    if (!short || short.channel !== channel) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (short.uploader_id !== userId && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const newStem = canonicalStem(meta, short.id);
    const { storageKey, posterKey } = renameShortFiles(
      channel,
      short.storage_key,
      short.poster_key,
      newStem
    );
    db.prepare(
      "UPDATE shorts SET caption = ?, storage_key = ?, poster_key = ? WHERE id = ?"
    ).run(buildCaption(title, hashtags), storageKey, posterKey, short.id);
    return NextResponse.json({ ok: true, storage_key: storageKey });
  } catch (err) {
    console.error("rename failed", err);
    return NextResponse.json({ error: "Rename failed." }, { status: 500 });
  }
}
