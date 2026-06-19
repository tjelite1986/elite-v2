"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Hash } from "lucide-react";
import PostAvatar from "@/components/post-avatar";

interface Account {
  username: string;
  display_name: string | null;
  type: "user" | "creator";
}
interface Tag {
  tag: string;
  count: number;
}

// Search bar for accounts + hashtags (used at the top of Explore). Debounced;
// shows a results panel while typing, otherwise renders nothing.
export default function PostSearch() {
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (!term) {
      setAccounts([]);
      setTags([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
          const d = await res.json();
          setAccounts(d.accounts || []);
          setTags(d.tags || []);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const hasResults = accounts.length > 0 || tags.length > 0;

  return (
    <div className="mb-4 px-2">
      <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5">
        <Search size={16} className="text-white/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people and #tags"
          className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
        />
      </div>

      {q.trim() && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
          {loading && !hasResults && (
            <p className="px-4 py-3 text-sm text-white/50">Searching…</p>
          )}
          {!loading && !hasResults && (
            <p className="px-4 py-3 text-sm text-white/50">No matches.</p>
          )}
          {accounts.map((a) => (
            <Link
              key={`${a.type}-${a.username}`}
              href={`/posts/u/${a.username}`}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
            >
              <PostAvatar username={a.username} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  @{a.username}
                </span>
                {a.display_name && (
                  <span className="block truncate text-xs text-white/50">
                    {a.display_name}
                  </span>
                )}
              </span>
            </Link>
          ))}
          {tags.map((t) => (
            <Link
              key={t.tag}
              href={`/posts/tag/${encodeURIComponent(t.tag)}`}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/70">
                <Hash size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  #{t.tag}
                </span>
                <span className="block text-xs text-white/50">
                  {t.count} post{t.count === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
