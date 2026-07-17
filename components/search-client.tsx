"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Newspaper,
  MessageCircle,
  Users,
  Image as ImageIcon,
  Clapperboard,
  BookOpen,
  Hash,
} from "lucide-react";
import PostAvatar from "@/components/post-avatar";

interface Results {
  people: { username: string; display_name: string | null; type: "user" | "creator" }[];
  posts: { id: number; snippet: string; author: string | null; created_at: string }[];
  messages: { id: number; snippet: string; peer: string; created_at: string }[];
  channelMessages: { id: number; snippet: string; channel: string; sender: string; created_at: string }[];
  gallery: { id: number; filename: string; snippet: string }[];
  shorts: { id: number; snippet: string; profile: string | null; channel: string }[];
  books: { slug: string; title: string; author: string | null }[];
}

const EMPTY: Results = {
  people: [], posts: [], messages: [], channelMessages: [], gallery: [], shorts: [], books: [],
};

// FTS snippet() marks matches as [term]; render those spans highlighted.
function Snippet({ text }: { text: string }) {
  const parts = (text || "").split(/\[([^\]]*)\]/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-blue-400">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
        {icon}
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">{children}</div>
    </section>
  );
}

function Row({ href, primary, secondary }: { href: string; primary: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <Link href={href} className="block px-4 py-2.5 transition hover:bg-white/5">
      <span className="block truncate text-sm text-white">{primary}</span>
      {secondary && <span className="block truncate text-xs text-white/50">{secondary}</span>}
    </Link>
  );
}

export default function SearchClient() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (res.ok && mySeq === seq.current) setResults(await res.json());
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const total =
    results.people.length + results.posts.length + results.messages.length +
    results.channelMessages.length + results.gallery.length + results.shorts.length +
    results.books.length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-32 pt-20 text-white md:pt-24">
      <div className="mb-6 flex items-center gap-2 rounded-full bg-white/10 px-4 py-3">
        <Search size={18} className="text-white/50" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts, messages, photos, shorts, books, people"
          className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
        />
      </div>

      {q.trim().length < 2 ? (
        <p className="px-1 text-sm text-white/40">
          Type at least two characters to search everything you have access to.
        </p>
      ) : loading && total === 0 ? (
        <p className="px-1 text-sm text-white/40">Searching…</p>
      ) : total === 0 ? (
        <p className="px-1 text-sm text-white/40">No matches.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {results.people.length > 0 && (
            <Section title="People" icon={<Users size={13} />}>
              {results.people.map((p) => (
                <Link
                  key={`${p.type}-${p.username}`}
                  href={`/people/${encodeURIComponent(p.username)}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
                >
                  <PostAvatar username={p.username} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">@{p.username}</span>
                    {p.display_name && (
                      <span className="block truncate text-xs text-white/50">{p.display_name}</span>
                    )}
                  </span>
                </Link>
              ))}
            </Section>
          )}
          {results.posts.length > 0 && (
            <Section title="Posts" icon={<Newspaper size={13} />}>
              {results.posts.map((p) => (
                <Row
                  key={p.id}
                  href={p.author ? `/people/${encodeURIComponent(p.author)}?tab=photos` : "/posts"}
                  primary={<Snippet text={p.snippet} />}
                  secondary={p.author ? `@${p.author}` : undefined}
                />
              ))}
            </Section>
          )}
          {results.messages.length > 0 && (
            <Section title="Direct messages" icon={<MessageCircle size={13} />}>
              {results.messages.map((m) => (
                <Row
                  key={m.id}
                  href="/messages"
                  primary={<Snippet text={m.snippet} />}
                  secondary={`with @${m.peer}`}
                />
              ))}
            </Section>
          )}
          {results.channelMessages.length > 0 && (
            <Section title="Channels" icon={<Hash size={13} />}>
              {results.channelMessages.map((m) => (
                <Row
                  key={m.id}
                  href="/messages"
                  primary={<Snippet text={m.snippet} />}
                  secondary={`#${m.channel} — @${m.sender}`}
                />
              ))}
            </Section>
          )}
          {results.gallery.length > 0 && (
            <Section title="My photos" icon={<ImageIcon size={13} />}>
              {results.gallery.map((g) => (
                <Row
                  key={g.id}
                  href="/gallery"
                  primary={g.filename}
                  secondary={g.snippet ? <Snippet text={g.snippet} /> : undefined}
                />
              ))}
            </Section>
          )}
          {results.shorts.length > 0 && (
            <Section title="Shorts" icon={<Clapperboard size={13} />}>
              {results.shorts.map((s) => (
                <Row
                  key={s.id}
                  href={s.channel === "main" ? "/shorts" : "/shorts18"}
                  primary={<Snippet text={s.snippet} />}
                  secondary={s.profile ? `@${s.profile}` : undefined}
                />
              ))}
            </Section>
          )}
          {results.books.length > 0 && (
            <Section title="Books" icon={<BookOpen size={13} />}>
              {results.books.map((b) => (
                <Row key={b.slug} href="/books" primary={b.title} secondary={b.author ?? undefined} />
              ))}
            </Section>
          )}
        </div>
      )}
    </main>
  );
}
