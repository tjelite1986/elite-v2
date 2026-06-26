"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Upload,
  RefreshCw,
  Search,
  Trash2,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Book {
  slug: string;
  title: string;
  author: string | null;
  format: "epub" | "pdf" | "cbz";
  size_bytes: number | null;
  page_count: number | null;
  added_at: string;
  percent: number;
  last_read_at: string | null;
  finished_at: string | null;
  has_cover: number;
}

const FORMAT_TINT: Record<Book["format"], string> = {
  epub: "from-emerald-500/40 to-emerald-700/20",
  pdf: "from-rose-500/40 to-rose-700/20",
  cbz: "from-amber-500/40 to-amber-700/20",
};

type Sort = "added" | "title" | "progress";

function readingTime(b: Book): string | null {
  let minutes = 0;
  if (b.format === "pdf" && b.page_count) minutes = b.page_count * 2;
  else if (b.format === "cbz" && b.page_count) minutes = b.page_count * 0.4;
  else if (b.format === "epub" && b.size_bytes)
    minutes = (b.size_bytes / 1024 / 2.2) / 250; // ~rough words / 250 wpm
  if (minutes < 1) return null;
  if (minutes < 60) return `${Math.round(minutes)} min read`;
  return `${Math.round(minutes / 60)} h read`;
}

export default function BooksClient({ isAdmin }: { isAdmin: boolean }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<"all" | Book["format"]>("all");
  const [sort, setSort] = useState<Sort>("added");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const res = await fetch("/api/books");
    if (res.ok) setBooks((await res.json()).books);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const continueReading = useMemo(
    () =>
      books
        .filter((b) => b.percent > 0 && !b.finished_at)
        .sort((a, b) => (b.last_read_at || "").localeCompare(a.last_read_at || ""))
        .slice(0, 6),
    [books]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter(
      (b) =>
        (format === "all" || b.format === format) &&
        (!q ||
          b.title.toLowerCase().includes(q) ||
          (b.author || "").toLowerCase().includes(q))
    );
    list = [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "progress") return b.percent - a.percent;
      return (b.added_at || "").localeCompare(a.added_at || "");
    });
    return list;
  }, [books, query, format, sort]);

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/books", { method: "POST", body: fd });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Upload failed.");
      } else {
        await load();
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const scan = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/books/scan", { method: "POST" });
      if (!res.ok) setError("Scan failed.");
      else await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    if (!confirm("Delete this book for everyone?")) return;
    setBooks((bs) => bs.filter((b) => b.slug !== slug));
    await fetch(`/api/books/${slug}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-20 text-white md:pt-24">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <BookOpen className="h-7 w-7" /> Books
          </h1>
          <p className="mt-1 text-sm text-white/50">
            A shared library — EPUB, PDF and comics, with your own reading
            progress.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".epub,.pdf,.cbz,.zip"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium hover:bg-white/25 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> Upload
            </button>
            <button
              onClick={scan}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Rescan
            </button>
          </div>
        )}
      </header>

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {continueReading.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold text-white/80">
            Continue reading
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {continueReading.map((b) => (
              <BookCard key={b.slug} book={b} isAdmin={isAdmin} onDelete={remove} />
            ))}
          </div>
        </section>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or author..."
            className="w-full rounded-full bg-white/10 py-2.5 pl-10 pr-4 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          className="rounded-full bg-white/10 px-4 py-2.5 text-sm focus:outline-none"
        >
          <option value="all">All formats</option>
          <option value="epub">EPUB</option>
          <option value="pdf">PDF</option>
          <option value="cbz">Comics</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded-full bg-white/10 px-4 py-2.5 text-sm focus:outline-none"
        >
          <option value="added">Recently added</option>
          <option value="title">Title</option>
          <option value="progress">Progress</option>
        </select>
      </div>

      {loading ? (
        <div className="py-20 text-center text-white/40">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-16 text-center text-sm text-white/50">
          No books yet.{isAdmin && " Upload one to get started."}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {filtered.map((b) => (
            <BookCard key={b.slug} book={b} isAdmin={isAdmin} onDelete={remove} />
          ))}
        </div>
      )}
    </main>
  );
}

function BookCard({
  book,
  isAdmin,
  onDelete,
}: {
  book: Book;
  isAdmin: boolean;
  onDelete: (slug: string) => void;
}) {
  const time = readingTime(book);
  return (
    <div className="group relative">
      <Link href={`/books/${book.slug}`} className="block">
        <div
          className={cn(
            "relative aspect-[2/3] overflow-hidden rounded-xl bg-gradient-to-br",
            FORMAT_TINT[book.format]
          )}
        >
          {book.has_cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/books/${book.slug}/cover`}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-3 text-center text-xs font-medium text-white/80">
              {book.title}
            </div>
          )}
          <span className="absolute left-1.5 top-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {book.format}
          </span>
          {book.finished_at && (
            <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-500/90">
              <Check className="h-3 w-3" />
            </span>
          )}
          {book.percent > 0 && !book.finished_at && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <span
                className="block h-full bg-blue-500"
                style={{ width: `${book.percent}%` }}
              />
            </span>
          )}
        </div>
      </Link>
      <div className="mt-1.5 px-0.5">
        <div className="truncate text-xs font-medium">{book.title}</div>
        {book.author && (
          <div className="truncate text-[11px] text-white/40">{book.author}</div>
        )}
        {time && <div className="text-[10px] text-white/30">{time}</div>}
      </div>
      {isAdmin && (
        <button
          onClick={() => onDelete(book.slug)}
          className="absolute right-1.5 top-8 hidden rounded-md bg-black/60 p-1.5 text-red-300 hover:bg-black/80 group-hover:block"
          aria-label="Delete book"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
