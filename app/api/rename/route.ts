import { NextResponse } from "next/server";
import path from "node:path";
import { db, GalleryItemRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseHashtags } from "@/lib/import-naming";
import { canonicalStem } from "@/lib/import-naming";
import { renameGalleryFiles } from "@/lib/gallery-storage";
import { setItemTags } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

// None of the media libraries that left this app is renameable here any more —
// main shorts went to tikshortis on 2026-08-31, 18+ shorts to adshortis on
// 2026-09-15, the photo posts to elitogram on 2026-09-16 — and each owns the
// renaming of its own files. The gallery is what is left to re-title.
type Section = "gallery";
const SECTIONS: Section[] = ["gallery"];

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

  const rows = db
    .prepare(
      `SELECT id, filename AS title FROM gallery_items
       WHERE is_deleted = 0 ${isAdmin ? "" : "AND user_id = @userId"}
       ${q ? "AND filename LIKE @like" : ""}
       ORDER BY id DESC LIMIT 60`
    )
    .all({ userId, like }) as { id: number; title: string }[];
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
        .prepare("SELECT * FROM gallery_items WHERE id = ? AND is_deleted = 0")
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

    return NextResponse.json({ error: "Invalid section." }, { status: 400 });
  } catch (err) {
    console.error("rename failed", err);
    return NextResponse.json({ error: "Rename failed." }, { status: 500 });
  }
}
