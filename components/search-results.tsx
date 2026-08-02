"use client";

import Link from "next/link";
import {
  Newspaper,
  MessageCircle,
  Users,
  Image as ImageIcon,
  Clapperboard,
  Film,
  BookOpen,
  Hash,
} from "lucide-react";
import PostAvatar from "@/components/post-avatar";

// Shared shape + rendering for global search hits, used by BOTH the /search
// page and the home dashboard's search box — so a new content type only has to
// be added in one place and the two surfaces can never drift apart.

export interface Results {
  people: { username: string; display_name: string | null; type: "user" | "creator" }[];
  posts: { id: number; snippet: string; author: string | null; created_at: string }[];
  messages: { id: number; snippet: string; peer: string; created_at: string }[];
  channelMessages: { id: number; snippet: string; channel: string; sender: string; created_at: string }[];
  gallery: { id: number; filename: string; snippet: string }[];
  shorts: { id: number; snippet: string; profile: string | null; channel: string }[];
  videos: { id: number; snippet: string; folder: string; channel: string; duration: number | null }[];
  books: { slug: string; title: string; author: string | null }[];
}

export const EMPTY: Results = {
  people: [], posts: [], messages: [], channelMessages: [], gallery: [], shorts: [], videos: [], books: [],
};

export function countResults(r: Results): number {
  return (
    r.people.length + r.posts.length + r.messages.length +
    r.channelMessages.length + r.gallery.length + r.shorts.length +
    r.videos.length + r.books.length
  );
}

// mm:ss / h:mm:ss, matching the duration badge on a video card.
function duration(seconds: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}

// FTS snippet() marks matches as [term]; render those spans highlighted.
export function Snippet({ text }: { text: string }) {
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

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
        {icon}
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
        {children}
      </div>
    </section>
  );
}

function Row({
  href,
  primary,
  secondary,
}: {
  href: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block px-4 py-2.5 transition hover:bg-white/5">
      <span className="block truncate text-sm text-white">{primary}</span>
      {secondary && (
        <span className="block truncate text-xs text-white/50">{secondary}</span>
      )}
    </Link>
  );
}

// `perSection` caps each group — the dashboard box shows a taste of each type
// and links on to the full page, while /search passes nothing and shows all.
export default function SearchResultList({
  results,
  perSection,
}: {
  results: Results;
  perSection?: number;
}) {
  const cap = <T,>(rows: T[]): T[] =>
    perSection ? rows.slice(0, perSection) : rows;

  return (
    <div className="flex flex-col gap-6">
      {results.people.length > 0 && (
        <Section title="People" icon={<Users size={13} />}>
          {cap(results.people).map((p) => (
            <Link
              key={`${p.type}-${p.username}`}
              href={`/people/${encodeURIComponent(p.username)}`}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
            >
              <PostAvatar username={p.username} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  @{p.username}
                </span>
                {p.display_name && (
                  <span className="block truncate text-xs text-white/50">
                    {p.display_name}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </Section>
      )}
      {results.videos.length > 0 && (
        <Section title="Videos" icon={<Film size={13} />}>
          {cap(results.videos).map((v) => (
            <Row
              key={v.id}
              href={`${v.channel === "main" ? "/videos" : "/videos18"}/${v.id}`}
              primary={<Snippet text={v.snippet} />}
              secondary={[v.folder, duration(v.duration)].filter(Boolean).join(" · ")}
            />
          ))}
        </Section>
      )}
      {results.posts.length > 0 && (
        <Section title="Posts" icon={<Newspaper size={13} />}>
          {cap(results.posts).map((p) => (
            <Row
              key={p.id}
              href={p.author ? `/people/${encodeURIComponent(p.author)}?tab=photos` : "/posts"}
              primary={<Snippet text={p.snippet} />}
              secondary={p.author ? `@${p.author}` : undefined}
            />
          ))}
        </Section>
      )}
      {results.shorts.length > 0 && (
        <Section title="Shorts" icon={<Clapperboard size={13} />}>
          {cap(results.shorts).map((s) => (
            <Row
              key={s.id}
              href={s.channel === "main" ? "/shorts" : "/shorts18"}
              primary={<Snippet text={s.snippet} />}
              secondary={s.profile ? `@${s.profile}` : undefined}
            />
          ))}
        </Section>
      )}
      {results.messages.length > 0 && (
        <Section title="Direct messages" icon={<MessageCircle size={13} />}>
          {cap(results.messages).map((m) => (
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
          {cap(results.channelMessages).map((m) => (
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
          {cap(results.gallery).map((g) => (
            <Row
              key={g.id}
              href="/gallery"
              primary={g.filename}
              secondary={g.snippet ? <Snippet text={g.snippet} /> : undefined}
            />
          ))}
        </Section>
      )}
      {results.books.length > 0 && (
        <Section title="Books" icon={<BookOpen size={13} />}>
          {cap(results.books).map((b) => (
            <Row key={b.slug} href="/books" primary={b.title} secondary={b.author ?? undefined} />
          ))}
        </Section>
      )}
    </div>
  );
}
