"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Star,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import VideoCard, { type VideoCardData } from "@/components/video-card";

export interface Performer {
  slug: string;
  name: string;
  full_name: string | null;
  disambiguation: string | null;
  tpdb_id: string | null;
  bio: string | null;
  birthday: string | null;
  deathday: string | null;
  birthplace: string | null;
  nationality: string | null;
  ethnicity: string | null;
  gender: string | null;
  astrology: string | null;
  height: string | null;
  weight: string | null;
  measurements: string | null;
  cupsize: string | null;
  waist: string | null;
  hips: string | null;
  hair_colour: string | null;
  eye_colour: string | null;
  tattoos: string | null;
  piercings: string | null;
  fake_boobs: number | null;
  same_sex_only: number | null;
  career_start: number | null;
  career_end: number | null;
  rating: number | null;
  aliases: string | null;
  links: string | null;
  image_key: string | null;
  video_count: number;
  images: number[];
}

function age(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null;
  const born = new Date(birthday);
  if (Number.isNaN(born.getTime())) return null;
  const end = deathday ? new Date(deathday) : new Date();
  if (Number.isNaN(end.getTime())) return null;
  let years = end.getFullYear() - born.getFullYear();
  const before =
    end.getMonth() < born.getMonth() ||
    (end.getMonth() === born.getMonth() && end.getDate() < born.getDate());
  if (before) years--;
  return years >= 0 && years < 130 ? years : null;
}

function parseList<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Five stars with a half step, matching the source page's presentation.
function Rating({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex">
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, value - i));
          return (
            <span key={i} className="relative">
              <Star size={16} className="text-white/15" />
              {fill > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star size={16} className="fill-amber-400 text-amber-400" />
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span className="text-xs text-white/50">{value.toFixed(1)}</span>
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs">
      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-medium text-white/60">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-white/85">
        {value}
      </span>
    </div>
  );
}

// Performer profile, laid out after the ThePornDB page it draws from: photo
// strip, name with nationality and birth year, rating, biography, a grid of
// vital statistics, aliases, external links, then the films in this library.
export default function PerformerProfile({
  performer: initial,
  videos,
  isAdmin,
}: {
  performer: Performer;
  videos: VideoCardData[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [performer, setPerformer] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [allLinks, setAllLinks] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useBackDismiss(lightbox !== null, () => setLightbox(null));

  const refresh = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/videos/performers/${performer.slug}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (data.performer) setPerformer(data.performer);
      setNote(data.message || null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const years = age(performer.birthday, performer.deathday);
  const aliases = parseList<string>(performer.aliases);
  const links = parseList<{ key: string; value: string }>(performer.links);
  const shownLinks = allLinks ? links : links.slice(0, 6);

  const born = performer.birthday
    ? `${performer.birthday}${years !== null ? ` (${years})` : ""}`
    : null;
  const career =
    performer.career_start || performer.career_end
      ? `${performer.career_start ?? "?"}–${performer.career_end ?? "now"}`
      : null;
  const yesNo = (v: number | null) =>
    v === null ? null : v ? "Yes" : "No";

  const facts: [string, string | null][] = [
    ["Gender", performer.gender],
    ["Birthday", born],
    ["Died", performer.deathday],
    ["Astrology", performer.astrology],
    ["Career", career],
    ["Birthplace", performer.birthplace],
    ["Ethnicity", performer.ethnicity],
    ["Nationality", performer.nationality],
    ["Cupsize", performer.cupsize],
    ["Hair", performer.hair_colour],
    ["Eyes", performer.eye_colour],
    ["Height", performer.height],
    ["Weight", performer.weight],
    ["Measurements", performer.measurements],
    ["Tattoos", performer.tattoos],
    ["Piercings", performer.piercings],
    ["Fake boobs", yesNo(performer.fake_boobs)],
    ["Same-sex only", yesNo(performer.same_sex_only)],
  ];
  const shownFacts = facts.filter((f): f is [string, string] => Boolean(f[1]));

  const subtitle = [
    performer.nationality,
    performer.birthday ? `b${performer.birthday.slice(0, 4)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-28 pt-4 text-white sm:px-5">
      {/* Photo strip */}
      {performer.images.length > 0 ? (
        <div className="-mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {performer.images.map((i) => (
            <button
              key={i}
              onClick={() => setLightbox(i)}
              className="h-56 w-40 shrink-0 overflow-hidden rounded-xl bg-white/5 sm:h-72 sm:w-52"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/videos/performers/${performer.slug}/image?i=${i}`}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]"
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-4">
        {performer.images.length === 0 && (
          <div className="size-24 shrink-0 overflow-hidden rounded-full bg-white/5">
            {performer.image_key ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/videos/performers/${performer.slug}/image`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-white/20">
                <UserRound size={32} />
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">
            {performer.name}
            {subtitle && (
              <span className="ml-2 text-base font-normal text-white/40">
                ({subtitle})
              </span>
            )}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
            {performer.rating !== null && <Rating value={performer.rating} />}
            <span>
              {performer.video_count}{" "}
              {performer.video_count === 1 ? "video" : "videos"} here
            </span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {performer.tpdb_id && (
              <a
                href={`https://theporndb.net/performers/${performer.tpdb_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-white"
              >
                <ExternalLink size={12} />
                ThePornDB
              </a>
            )}
            {isAdmin && (
              <button
                onClick={refresh}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs transition hover:bg-white/10 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Refresh profile
              </button>
            )}
            {note && <span className="text-xs text-white/40">{note}</span>}
          </div>
        </div>
      </div>

      {performer.bio && (
        <p className="mt-4 whitespace-pre-wrap rounded-xl bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/75">
          {performer.bio}
        </p>
      )}

      {shownFacts.length > 0 && (
        <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {shownFacts.map(([label, value]) => (
            <Fact key={label} label={label} value={value} />
          ))}
        </div>
      )}

      {aliases.length > 0 && (
        <p className="mt-3 text-xs text-white/45">
          <span className="text-white/30">Also known as: </span>
          {aliases.join(", ")}
        </p>
      )}

      {links.length > 0 && (
        <div className="mt-4">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {shownLinks.map((l) => (
              <a
                key={l.key + l.value}
                href={l.value}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs transition hover:bg-white/10"
              >
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-medium text-white/60">
                  {l.key}
                </span>
                <span className="min-w-0 flex-1 truncate text-white/50">
                  {l.value.replace(/^https?:\/\//, "")}
                </span>
              </a>
            ))}
          </div>
          {links.length > 6 && (
            <button
              onClick={() => setAllLinks((v) => !v)}
              className="mt-2 w-full rounded-lg bg-white/[0.04] py-1.5 text-xs text-white/50 transition hover:bg-white/10"
            >
              {allLinks ? "Show less" : `Show all ${links.length}`}
            </button>
          )}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-white/80">
        In this library
      </h2>
      {videos.length === 0 ? (
        <p className="text-sm text-white/40">Nothing linked yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} basePath="/videos18" />
          ))}
        </div>
      )}

      <Link
        href="/videos18/performers"
        className="mt-6 inline-block text-sm text-white/40 transition hover:text-white"
      >
        ← All performers
      </Link>

      {/* Full-size photo */}
      {lightbox !== null && (
        <div
          className={cn(
            "fixed inset-0 z-[1200] flex items-center justify-center bg-black/90 p-4"
          )}
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/videos/performers/${performer.slug}/image?i=${lightbox}`}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
