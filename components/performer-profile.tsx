"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, UserRound } from "lucide-react";
import VideoCard, { type VideoCardData } from "@/components/video-card";

export interface Performer {
  slug: string;
  name: string;
  tpdb_id: string | null;
  bio: string | null;
  birthday: string | null;
  birthplace: string | null;
  nationality: string | null;
  height: string | null;
  measurements: string | null;
  hair_colour: string | null;
  eye_colour: string | null;
  career_start: number | null;
  image_key: string | null;
  video_count: number;
}

function age(birthday: string | null): number | null {
  if (!birthday) return null;
  const born = new Date(birthday);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) years--;
  return years >= 0 && years < 130 ? years : null;
}

// One performer: portrait, the facts ThePornDB knows, and every video in the
// library they are credited on.
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

  const years = age(performer.birthday);
  const facts: [string, string][] = [];
  if (performer.birthday) {
    facts.push([
      "Born",
      years ? `${performer.birthday} (${years})` : performer.birthday,
    ]);
  }
  if (performer.birthplace) facts.push(["From", performer.birthplace]);
  if (performer.nationality) facts.push(["Nationality", performer.nationality]);
  if (performer.height) facts.push(["Height", performer.height]);
  if (performer.measurements) facts.push(["Measurements", performer.measurements]);
  if (performer.hair_colour) facts.push(["Hair", performer.hair_colour]);
  if (performer.eye_colour) facts.push(["Eyes", performer.eye_colour]);
  if (performer.career_start) {
    facts.push(["Career start", String(performer.career_start)]);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-28 pt-4 text-white sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="mx-auto size-32 shrink-0 overflow-hidden rounded-full bg-white/5 sm:mx-0 sm:size-40">
          {performer.image_key ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/videos/performers/${performer.slug}/image`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-white/20">
              <UserRound size={40} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="text-2xl font-semibold">{performer.name}</h1>
          <p className="mt-1 text-sm text-white/50">
            {performer.video_count}{" "}
            {performer.video_count === 1 ? "video" : "videos"} in the library
          </p>

          {facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:max-w-md">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="truncate text-white/40">{label}</dt>
                  <dd className="truncate">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
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
        <p className="mt-5 whitespace-pre-wrap rounded-xl bg-white/5 px-4 py-3 text-sm text-white/75">
          {performer.bio}
        </p>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-white/80">Videos</h2>
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
    </div>
  );
}
