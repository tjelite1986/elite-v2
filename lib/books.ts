import fs from "fs";
import path from "path";
import { db } from "./db";
import { booksRoot, bookFilePath, coverFilePath } from "./books-storage";
import { analyzePageCount, extractCover, coverExists } from "./book-covers";

export type BookFormat = "epub" | "pdf" | "cbz";

export interface BookRow {
  slug: string;
  title: string;
  author: string | null;
  format: BookFormat;
  storage_key: string;
  cover_key: string | null;
  size_bytes: number | null;
  page_count: number | null;
  added_at: string;
  added_by: number | null;
}

export interface BookWithState extends BookRow {
  percent: number;
  position: string | null;
  last_read_at: string | null;
  finished_at: string | null;
  has_cover: number;
}

function prettyName(filename: string): string {
  return (
    path
      .basename(filename, path.extname(filename))
      .replace(/[_.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled"
  );
}

export function slugify(s: string): string {
  const base =
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "book";
  let slug = base;
  let i = 2;
  while (db.prepare("SELECT 1 FROM books WHERE slug = ?").get(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function formatFromExt(filename: string): BookFormat | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".pdf") return "pdf";
  if (ext === ".cbz" || ext === ".zip") return "cbz";
  return null;
}

export function getBook(slug: string): BookRow | undefined {
  return db.prepare("SELECT * FROM books WHERE slug = ?").get(slug) as
    | BookRow
    | undefined;
}

export function listBooks(userId: number): BookWithState[] {
  return db
    .prepare(
      `SELECT b.*, s.percent AS percent, s.position AS position,
              s.last_read_at AS last_read_at, s.finished_at AS finished_at
       FROM books b
       LEFT JOIN book_reading_state s
         ON s.book_slug = b.slug AND s.user_id = ?
       ORDER BY b.added_at DESC`
    )
    .all(userId)
    .map((r) => {
      const row = r as BookRow & {
        percent: number | null;
        position: string | null;
        last_read_at: string | null;
        finished_at: string | null;
      };
      return {
        ...row,
        percent: row.percent ?? 0,
        has_cover: coverExists(row.cover_key) ? 1 : 0,
      };
    });
}

export async function ingestUpload(opts: {
  buffer: Buffer;
  filename: string;
  title?: string;
  author?: string;
  addedBy: number;
}): Promise<BookRow> {
  const format = formatFromExt(opts.filename);
  if (!format) throw new Error("Unsupported format");

  const title = opts.title?.trim() || prettyName(opts.filename);
  const slug = slugify(title);
  const storageKey = `${slug}.${format}`;
  await fs.promises.writeFile(bookFilePath(storageKey), opts.buffer);

  const pageCount = await analyzePageCount(format, storageKey);
  db.prepare(
    `INSERT INTO books (slug, title, author, format, storage_key, size_bytes, page_count, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    slug,
    title,
    opts.author?.trim() || null,
    format,
    storageKey,
    opts.buffer.length,
    pageCount,
    opts.addedBy
  );

  const coverKey = await extractCover(slug, format, storageKey);
  if (coverKey) {
    db.prepare("UPDATE books SET cover_key = ? WHERE slug = ?").run(coverKey, slug);
  }
  return getBook(slug)!;
}

export function deleteBook(slug: string): void {
  const book = getBook(slug);
  if (!book) return;
  try {
    fs.unlinkSync(bookFilePath(book.storage_key));
  } catch {
    /* file may already be gone */
  }
  if (book.cover_key) {
    try {
      fs.unlinkSync(coverFilePath(book.cover_key));
    } catch {
      /* ignore */
    }
  }
  db.prepare("DELETE FROM books WHERE slug = ?").run(slug);
}

// Reconcile the DB with the files on disk: ingest new files, drop rows whose
// file disappeared, and backfill covers. Returns counts.
export async function scanBooks(
  addedBy: number
): Promise<{ added: number; removed: number; covers: number }> {
  const root = booksRoot();
  const onDisk = fs
    .readdirSync(root)
    .filter((f) => !f.startsWith(".") && formatFromExt(f));

  const known = new Set(
    (db.prepare("SELECT storage_key FROM books").all() as {
      storage_key: string;
    }[]).map((r) => r.storage_key)
  );

  let added = 0;
  for (const file of onDisk) {
    if (known.has(file)) continue;
    const format = formatFromExt(file)!;
    const buffer = await fs.promises.readFile(path.join(root, file));
    const title = prettyName(file);
    const slug = slugify(title);
    const storageKey = `${slug}.${format}`;
    // Rename on disk to the canonical slug-based key if needed.
    if (storageKey !== file) {
      await fs.promises.rename(path.join(root, file), bookFilePath(storageKey));
    }
    const pageCount = await analyzePageCount(format, storageKey);
    db.prepare(
      `INSERT INTO books (slug, title, author, format, storage_key, size_bytes, page_count, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(slug, title, null, format, storageKey, buffer.length, pageCount, addedBy);
    added++;
  }

  // Drop rows whose file no longer exists.
  let removed = 0;
  for (const b of db.prepare("SELECT slug, storage_key FROM books").all() as {
    slug: string;
    storage_key: string;
  }[]) {
    if (!fs.existsSync(bookFilePath(b.storage_key))) {
      db.prepare("DELETE FROM books WHERE slug = ?").run(b.slug);
      removed++;
    }
  }

  // Backfill any missing covers.
  let covers = 0;
  for (const b of db.prepare("SELECT * FROM books").all() as BookRow[]) {
    if (coverExists(b.cover_key)) continue;
    const key = await extractCover(b.slug, b.format, b.storage_key);
    if (key) {
      db.prepare("UPDATE books SET cover_key = ? WHERE slug = ?").run(key, b.slug);
      covers++;
    }
  }

  return { added, removed, covers };
}

export interface ReadingState {
  position: string | null;
  percent: number;
  last_read_at: string;
  finished_at: string | null;
}

export function getReadingState(
  slug: string,
  userId: number
): ReadingState | null {
  return (
    (db
      .prepare(
        "SELECT position, percent, last_read_at, finished_at FROM book_reading_state WHERE book_slug = ? AND user_id = ?"
      )
      .get(slug, userId) as ReadingState | undefined) ?? null
  );
}

export function setReadingState(
  slug: string,
  userId: number,
  patch: { position?: string; percent?: number; finished?: boolean }
): void {
  const percent =
    patch.percent != null
      ? Math.max(0, Math.min(100, Math.round(patch.percent)))
      : undefined;
  const finishedAt =
    patch.finished === true
      ? "datetime('now')"
      : patch.finished === false
      ? "NULL"
      : null; // leave unchanged

  // Upsert. COALESCE keeps existing values when a field isn't in the patch.
  db.prepare(
    `INSERT INTO book_reading_state (book_slug, user_id, position, percent, last_read_at, finished_at)
     VALUES (@slug, @uid, @position, @percent, datetime('now'),
             ${finishedAt === "datetime('now')" ? "datetime('now')" : "NULL"})
     ON CONFLICT(book_slug, user_id) DO UPDATE SET
       position = COALESCE(@position, position),
       percent = COALESCE(@percent, percent),
       last_read_at = datetime('now')${
         finishedAt ? `, finished_at = ${finishedAt}` : ""
       }`
  ).run({
    slug,
    uid: userId,
    position: patch.position ?? null,
    percent: percent ?? null,
  });
}
