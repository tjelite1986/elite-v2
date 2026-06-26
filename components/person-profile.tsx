"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Pencil, X, Link as LinkIcon, MapPin, CalendarDays, Lock } from "lucide-react";

// "Member since June 2026" from a sqlite datetime string.
function memberSinceLabel(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

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
import ProfileBadges from "@/components/profile-badges";
import FollowButton from "@/components/follow-button";
import PostFeed from "@/components/post-feed";
import PostGrid from "@/components/post-grid";
import ShortsGrid from "@/components/shorts-grid";
import ProfileShortsSettings from "@/components/profile-shorts-settings";
import ProfileMergeButton from "@/components/profile-merge-button";
import ProfileInstagramSync from "@/components/profile-instagram-sync";
import type { ResolvedPerson } from "@/lib/directory";

type Tab = "profile" | "photos" | "shorts" | "18plus";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

// Unified cross-section profile: header + tabs. The default "Profile" tab holds
// all the profile info (bio/links/Instagram + a content overview); the other
// tabs (Photos / Shorts / 18+) drill into a single section.
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

  // Shorts on a profile come from BOTH the creator profile (profile_id) AND the
  // person's own uploads (uploader_id), so a user's uploaded/imported clips show
  // here too — mirroring how posts union author_user_id/author_creator_id.
  const shortsQuery = (channel: "main" | "18plus"): Record<string, string> => {
    const profileId = channel === "18plus" ? person.shorts18Id : person.shortsMainId;
    const q: Record<string, string> = { channel };
    if (profileId) q.profile = String(profileId);
    if (person.userId) q.owner = String(person.userId);
    return q;
  };
  // A creator profile has a dedicated watch page; owner-only clips (no profile)
  // open the immersive feed focused on the clip, like the "Mine" view.
  const shortsHref = (channel: "main" | "18plus"): string => {
    const profileId = channel === "18plus" ? person.shorts18Id : person.shortsMainId;
    const base = channel === "18plus" ? "/shorts18" : "/shorts";
    return profileId
      ? `${base}/profile/${profileId}/watch?focus=`
      : `${base}?focus=`;
  };

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "profile", label: "Profile", show: true },
    { id: "photos", label: "Photos", show: person.photos > 0 },
    { id: "shorts", label: "Shorts", show: person.shortsMain > 0 },
    { id: "18plus", label: "18+", show: person.shorts18 > 0 },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>("profile");
  const [selecting, setSelecting] = useState(false);
  const [avatarBust, setAvatarBust] = useState(0);
  const [busy, setBusy] = useState(false);

  const hasInfo =
    Boolean(person.displayName && person.displayName !== person.handle) ||
    Boolean(person.bio) ||
    person.links.length > 0 ||
    Boolean(person.instagramHandle);

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
          {person.shortsMain > 0 && (
            <Section label="Shorts">
              <ShortsGrid
                query={shortsQuery("main")}
                hrefPrefix="#"
                empty="No shorts."
                onSelect={pickShort}
              />
            </Section>
          )}
          {person.shorts18 > 0 && (
            <Section label="18+">
              <ShortsGrid
                query={shortsQuery("18plus")}
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

          {/* Profile tab — all the info + a content overview. The landing tab. */}
          {tab === "profile" && (
            <div className="space-y-5">
              {hasInfo && (
                <div>
                  {person.displayName && person.displayName !== person.handle && (
                    <div className="text-sm font-semibold">{person.displayName}</div>
                  )}
                  {person.bio && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/80">{person.bio}</p>
                  )}
                  {(person.links.length > 0 || person.instagramHandle) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {person.instagramHandle && (
                        <a
                          href={`https://www.instagram.com/${person.instagramHandle}/`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-rose-300 transition hover:bg-white/15 hover:text-rose-200"
                        >
                          <Camera size={12} />@{person.instagramHandle}
                        </a>
                      )}
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

              {!hasInfo && (
                <p className="text-sm text-white/40">
                  {person.isOwn
                    ? "Add a bio and links from Edit profile."
                    : "No bio yet."}
                </p>
              )}

              {/* Earned achievement badges. */}
              {person.badges.length > 0 && (
                <ProfileBadges badges={person.badges} />
              )}

              {/* Custom fields (private ones already filtered server-side; the
                  owner sees a lock on their own private fields). */}
              {person.fields.length > 0 && (
                <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                  {person.fields.map((f, i) => (
                    <div key={i} className="contents">
                      <dt className="flex items-center gap-1 text-white/40">
                        {!f.public && person.isOwn && (
                          <Lock size={11} className="shrink-0" />
                        )}
                        {f.label}
                      </dt>
                      <dd className="min-w-0 break-words text-white/80">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* Location + member since */}
              {(person.location || person.memberSince) && (
                <div className="flex flex-col gap-1 text-sm text-white/60">
                  {person.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={14} className="shrink-0" />
                      <span>{person.location}</span>
                    </div>
                  )}
                  {person.memberSince && (
                    <div className="flex items-center gap-1.5">
                      <CalendarDays size={14} className="shrink-0" />
                      <span>Member since {memberSinceLabel(person.memberSince)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Statistics */}
              <div className="flex flex-wrap justify-around gap-4 rounded-2xl bg-white/5 px-4 py-4">
                <Stat value={person.followers} label="followers" />
                <Stat value={person.following} label="following" />
                <Stat value={person.photos} label="photos" />
                <Stat value={person.shortsMain} label="shorts" />
                {person.shorts18 > 0 && <Stat value={person.shorts18} label="18+" />}
              </div>

              {canManage && person.instagramHandle && (
                <ProfileInstagramSync
                  handle={person.handle}
                  initial={{
                    instagramHandle: person.instagramHandle,
                    autoPoll: person.igAutoPoll,
                    syncing: person.igSyncing,
                    lastSyncedAt: person.igLastSyncedAt,
                    lastSyncError: person.igLastSyncError,
                  }}
                />
              )}

              {isAdmin && (
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

              {/* Profile-info only — no content here. Photos/Shorts/18+ live in
                  their own tabs. More profile fields get added to this tab. */}
            </div>
          )}

          {tab === "photos" && <PostFeed query={personQuery} empty="No photos yet." />}

          {tab === "shorts" && person.shortsMain > 0 && (
            <ShortsGrid
              query={shortsQuery("main")}
              hrefPrefix={shortsHref("main")}
              empty="No shorts yet."
            />
          )}

          {tab === "18plus" && person.shorts18 > 0 && (
            <ShortsGrid
              query={shortsQuery("18plus")}
              hrefPrefix={shortsHref("18plus")}
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
