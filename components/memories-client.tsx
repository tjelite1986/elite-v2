"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarHeart, MessageCircle, Newspaper, Image as ImageIcon } from "lucide-react";

interface MemoryPost {
  id: number;
  caption: string | null;
  created_at: string;
  author: string | null;
  media_id: number | null;
}
interface MemoryPhoto {
  id: number;
  filename: string;
  media_version: number;
  taken_at: string;
}
interface MemoryMessage {
  id: number;
  body: string;
  created_at: string;
  peer: string;
  mine: number;
}

const yearOf = (d: string) => d.slice(0, 4);

function yearsAgoLabel(year: string): string {
  const diff = new Date().getFullYear() - Number(year);
  return diff === 1 ? "1 year ago" : `${diff} years ago`;
}

export default function MemoriesClient() {
  const [posts, setPosts] = useState<MemoryPost[]>([]);
  const [gallery, setGallery] = useState<MemoryPhoto[]>([]);
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/memories");
        if (res.ok) {
          const d = await res.json();
          setPosts(d.posts || []);
          setGallery(d.gallery || []);
          setMessages(d.messages || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Group everything by year, newest year first.
  const years = useMemo(() => {
    const map = new Map<string, { posts: MemoryPost[]; gallery: MemoryPhoto[]; messages: MemoryMessage[] }>();
    const bucket = (y: string) => {
      if (!map.has(y)) map.set(y, { posts: [], gallery: [], messages: [] });
      return map.get(y)!;
    };
    for (const p of posts) bucket(yearOf(p.created_at)).posts.push(p);
    for (const g of gallery) bucket(yearOf(g.taken_at)).gallery.push(g);
    for (const m of messages) bucket(yearOf(m.created_at)).messages.push(m);
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [posts, gallery, messages]);

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-32 pt-20 text-white md:pt-24">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-500/15">
          <CalendarHeart size={22} className="text-pink-400" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">On this day</h1>
          <p className="text-sm text-white/50">{today}, in earlier years</p>
        </div>
      </div>

      {loading ? (
        <p className="px-1 text-sm text-white/40">Looking back…</p>
      ) : years.length === 0 ? (
        <p className="px-1 text-sm text-white/40">
          Nothing from this date in earlier years yet. Come back another day.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {years.map(([year, data]) => (
            <section key={year}>
              <h2 className="mb-3 flex items-baseline gap-2 px-1">
                <span className="text-2xl font-bold">{year}</span>
                <span className="text-sm text-white/40">{yearsAgoLabel(year)}</span>
              </h2>

              {data.gallery.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
                    <ImageIcon size={13} /> Your photos
                  </h3>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {data.gallery.map((g) => (
                      <Link key={g.id} href="/gallery" className="relative aspect-square overflow-hidden rounded-lg bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/gallery/${g.id}/media?variant=thumb&v=${g.media_version}`}
                          alt={g.filename}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {data.posts.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
                    <Newspaper size={13} /> Posts
                  </h3>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {data.posts
                      .filter((p) => p.media_id)
                      .map((p) => (
                        <Link
                          key={p.id}
                          href={p.author ? `/people/${encodeURIComponent(p.author)}?tab=photos` : "/posts"}
                          className="relative aspect-square overflow-hidden rounded-lg bg-white/5"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/posts/media/${p.media_id}?size=thumb`}
                            alt={p.caption ?? ""}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {p.author && (
                            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[10px] text-white/90">
                              @{p.author}
                            </span>
                          )}
                        </Link>
                      ))}
                  </div>
                </div>
              )}

              {data.messages.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
                    <MessageCircle size={13} /> Messages
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
                    {data.messages.map((m) => (
                      <Link key={m.id} href="/messages" className="block px-4 py-2.5 transition hover:bg-white/5">
                        <span className="block truncate text-sm text-white">{m.body}</span>
                        <span className="block text-xs text-white/50">
                          {m.mine ? `you, to @${m.peer}` : `@${m.peer}, to you`}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
