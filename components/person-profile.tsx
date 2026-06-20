"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Pencil, X, Link as LinkIcon } from "lucide-react";

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function linkLabel(l: { label: string; url: string }): string {
  if (l.label) return l.label;
  try {
    return new URL(l.url).hostname.replace(/^www\./, "");
  } catch {
    return l.url;
  }
}
import PostAvatar from "@/components/post-avatar";
import FollowButton from "@/components/follow-button";
import PostFeed from "@/components/post-feed";
import PostGrid from "@/components/post-grid";
import ShortsGrid from "@/components/shorts-grid";
import ProfileShortsSettings from "@/components/profile-shorts-settings";
import ProfileMergeButton from "@/components/profile-merge-button";
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
  const router = useRouter();
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
  const [selecting, setSelecting] = useState(false);
  const [avatarBust, setAvatarBust] = useState(0);
  const [busy, setBusy] = useState(false);

  // Set the avatar from a chosen post image or clip poster, then leave select
  // mode and refresh so the new picture shows.
  const setAvatar = async (endpoint: string, body: Record<string, number>) => {
    if (busy) return;
    setBusy(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setSelecting(false);
      setAvatarBust(Date.now());
      router.refresh();
    }
  };
  const pickPhoto = (mediaId: number) =>
    setAvatar("/api/profile/avatar/from-media", { mediaId });
  const pickShort = (shortId: number) =>
    setAvatar("/api/profile/avatar/from-short", { shortId });

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-20 text-white">
      {/* Cover banner */}
      {person.hasBanner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/profiles/${encodeURIComponent(person.handle)}/banner`}
          alt=""
          className="mb-4 h-32 w-full rounded-2xl object-cover sm:h-40"
        />
      )}

      {/* Header */}
      <header className="mb-5 flex items-start gap-5">
        <PostAvatar
          key={avatarBust}
          username={person.handle}
          size={84}
          className="text-2xl"
          version={avatarBust}
        />
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
            {!person.isOwn &&
              person.followType !== null &&
              person.followId !== null && (
                <FollowButton
                  targetType={person.followType}
                  targetId={person.followId}
                  initialFollowing={person.viewerFollows}
                />
              )}
            {canManage && (
              <Link
                href={`/people/${person.handle}/edit`}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
              >
                <Pencil size={14} /> Edit profile
              </Link>
            )}
            {isAdmin && person.userId === null && (
              <ProfileMergeButton targetHandle={person.handle} />
            )}
            {canManage && (person.photos > 0 || person.shortsMain > 0 || person.shorts18 > 0) && (
              <button
                onClick={() => setSelecting((v) => !v)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
              >
                <Camera size={14} /> Profile photo
              </button>
            )}
          </div>
        </div>
      </header>

      {(person.displayName || person.bio || person.links.length > 0) && !selecting && (
        <div className="mb-5">
          {person.displayName && person.displayName !== person.handle && (
            <div className="text-sm font-semibold">{person.displayName}</div>
          )}
          {person.bio && (
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/80">{person.bio}</p>
          )}
          {person.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {person.links.filter((l) => isHttpUrl(l.url)).map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-rose-300 transition hover:bg-white/15 hover:text-rose-200"
                >
                  <LinkIcon size={12} />
                  {linkLabel(l)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {isAdmin && !selecting && (
        <ProfileShortsSettings
          channels={[
            ...(person.shortsMainId && person.shortsMainPollable
              ? [{
                  id: person.shortsMainId,
                  channel: "main" as const,
                  autoPoll: person.shortsMainAutoPoll,
                  basePath: "/shorts",
                }]
              : []),
            ...(person.shorts18Id && person.shorts18Pollable
              ? [{
                  id: person.shorts18Id,
                  channel: "18plus" as const,
                  autoPoll: person.shorts18AutoPoll,
                  basePath: "/shorts18",
                }]
              : []),
          ]}
        />
      )}

      {/* Select-a-profile-picture mode: scroll the real grids and tap any
          photo or clip. */}
      {selecting ? (
        <div className="space-y-6">
          <div className="sticky top-16 z-30 flex items-center justify-between rounded-xl bg-rose-500/90 px-4 py-2.5 text-sm font-semibold backdrop-blur">
            <span>{busy ? "Setting…" : "Tap a photo or clip to use as profile picture"}</span>
            <button onClick={() => setSelecting(false)} aria-label="Cancel" className="ml-3">
              <X size={18} />
            </button>
          </div>
          {person.photos > 0 && (
            <Section label="Photos">
              <PostGrid query={personQuery} empty="No photos." onSelect={pickPhoto} />
            </Section>
          )}
          {person.shortsMain > 0 && person.shortsMainId && (
            <Section label="Shorts">
              <ShortsGrid
                query={{ profile: String(person.shortsMainId) }}
                hrefPrefix="#"
                empty="No shorts."
                onSelect={pickShort}
              />
            </Section>
          )}
          {person.shorts18 > 0 && person.shorts18Id && (
            <Section label="18+">
              <ShortsGrid
                query={{ profile: String(person.shorts18Id) }}
                hrefPrefix="#"
                empty="No clips."
                onSelect={pickShort}
              />
            </Section>
          )}
        </div>
      ) : (
        <>
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
        </>
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
  onMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-white/80">{label}</h2>
        {onMore && (
          <button onClick={onMore} className="text-xs text-white/50 hover:text-white">
            See all
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
