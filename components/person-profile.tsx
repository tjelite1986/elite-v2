"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Pencil, X, Check } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import FollowButton from "@/components/follow-button";
import PostFeed from "@/components/post-feed";
import PostGrid from "@/components/post-grid";
import ShortsGrid from "@/components/shorts-grid";
import type { ResolvedPerson } from "@/lib/directory";

type Tab = "all" | "photos" | "shorts" | "18plus";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

// Unified cross-section profile: header + tabs (All / Photos / Shorts / 18+)
// pulling a person's content from every module they appear in.
export default function PersonProfile({
  person,
  isAdmin,
}: {
  person: ResolvedPerson;
  isAdmin: boolean;
}) {
  const canManage = person.isOwn || isAdmin;
  const personQuery: Record<string, string> = { scope: "person" };
  if (person.userId) personQuery.userId = String(person.userId);
  if (person.creatorId) personQuery.creatorId = String(person.creatorId);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "all", label: "All", show: true },
    { id: "photos", label: "Photos", show: person.photos > 0 },
    { id: "shorts", label: "Shorts", show: person.shortsMain > 0 },
    { id: "18plus", label: "18+", show: person.shorts18 > 0 },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>("all");
  const [picker, setPicker] = useState(false);
  const [avatarBust, setAvatarBust] = useState(0);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-24 text-white">
      {/* Header */}
      <header className="mb-5 flex items-start gap-5">
        <span key={avatarBust}>
          <PostAvatar username={person.handle} size={84} className="text-2xl" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">@{person.handle}</h1>
            {person.userId !== null && (
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                User
              </span>
            )}
          </div>
          <div className="mt-3 flex max-w-sm justify-between">
            <Stat value={person.photos} label="photos" />
            <Stat value={person.shortsMain} label="shorts" />
            {person.shorts18 > 0 && <Stat value={person.shorts18} label="18+" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {person.isOwn ? (
              <Link
                href="/posts/edit"
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
              >
                <Pencil size={14} /> Edit profile
              </Link>
            ) : (
              (person.userId !== null || person.creatorId !== null) && (
                <FollowButton
                  targetType={person.userId !== null ? "user" : "creator"}
                  targetId={(person.userId ?? person.creatorId) as number}
                  initialFollowing={person.viewerFollows}
                />
              )
            )}
            {canManage && person.photos > 0 && (
              <button
                onClick={() => setPicker(true)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
              >
                <Camera size={14} /> Profile photo
              </button>
            )}
          </div>
        </div>
      </header>

      {(person.displayName || person.bio) && (
        <div className="mb-5">
          {person.displayName && person.displayName !== person.handle && (
            <div className="text-sm font-semibold">{person.displayName}</div>
          )}
          {person.bio && (
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/80">{person.bio}</p>
          )}
        </div>
      )}

      {/* Tabs */}
      {visible.length > 1 && (
        <div className="mb-4 flex gap-1 border-b border-white/10">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "border-white text-white"
                  : "border-transparent text-white/50 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {tab === "all" && (
        <div className="space-y-6">
          {person.photos > 0 && (
            <Section label="Photos" onMore={() => setTab("photos")}>
              <PostGrid query={personQuery} empty="No photos." />
            </Section>
          )}
          {person.shortsMain > 0 && person.shortsMainId && (
            <Section label="Shorts" onMore={() => setTab("shorts")}>
              <ShortsGrid
                query={{ profile: String(person.shortsMainId) }}
                hrefPrefix={`/shorts/profile/${person.shortsMainId}/watch?focus=`}
                empty="No shorts."
              />
            </Section>
          )}
          {person.shorts18 > 0 && person.shorts18Id && (
            <Section label="18+" onMore={() => setTab("18plus")}>
              <ShortsGrid
                query={{ profile: String(person.shorts18Id) }}
                hrefPrefix={`/shorts18/profile/${person.shorts18Id}/watch?focus=`}
                empty="No clips."
              />
            </Section>
          )}
        </div>
      )}

      {tab === "photos" && <PostFeed query={personQuery} empty="No photos yet." />}

      {tab === "shorts" && person.shortsMainId && (
        <ShortsGrid
          query={{ profile: String(person.shortsMainId) }}
          hrefPrefix={`/shorts/profile/${person.shortsMainId}/watch?focus=`}
          empty="No shorts yet."
        />
      )}

      {tab === "18plus" && person.shorts18Id && (
        <ShortsGrid
          query={{ profile: String(person.shorts18Id) }}
          hrefPrefix={`/shorts18/profile/${person.shorts18Id}/watch?focus=`}
          empty="No clips yet."
        />
      )}

      {picker && (
        <AvatarPicker
          query={personQuery}
          onClose={() => setPicker(false)}
          onSet={() => {
            setPicker(false);
            setAvatarBust(Date.now());
          }}
        />
      )}
    </div>
  );
}

function Section({
  label,
  onMore,
  children,
}: {
  label: string;
  onMore: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-white/80">{label}</h2>
        <button onClick={onMore} className="text-xs text-white/50 hover:text-white">
          See all
        </button>
      </div>
      {children}
    </section>
  );
}

interface PickShort {
  id: number;
  has_poster: boolean;
  media: { id: number }[];
}

// Pick one of the person's photos to use as the profile picture.
function AvatarPicker({
  query,
  onClose,
  onSet,
}: {
  query: Record<string, string>;
  onClose: () => void;
  onSet: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PickShort[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL("/api/posts/feed", window.location.origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set("limit", "24");
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .catch(() => {});
  }, [query]);

  const choose = async (mediaId: number) => {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/profile/avatar/from-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onSet();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="flex max-h-[75%] flex-col rounded-t-2xl bg-neutral-900 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">Choose profile photo</span>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 overflow-y-auto p-1 sm:grid-cols-4">
          {items.map((p) =>
            p.media[0] ? (
              <button
                key={p.id}
                onClick={() => choose(p.media[0].id)}
                disabled={busy}
                className="group relative aspect-square overflow-hidden bg-white/5 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/posts/media/${p.media[0].id}?size=thumb`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:opacity-70"
                />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                  <Check size={24} className="text-white drop-shadow" />
                </span>
              </button>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
