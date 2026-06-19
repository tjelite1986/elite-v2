import Link from "next/link";
import { getCreators } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Grid of 18+ creators (auto-poll profiles + uploaders) with a cover thumbnail.
export default function Profiles18Page() {
  const creators = getCreators("18plus");

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-16 text-white">
      <h1 className="mb-4 px-1 text-lg font-semibold">Profiles</h1>
      {creators.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/50">No profiles yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {creators.map((c) => (
            <Link
              key={c.id}
              href={`/shorts18/profile/${c.id}`}
              className="overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <div className="aspect-[9/16] bg-black/30">
                {c.cover_id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/shorts/${c.cover_id}/poster`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="p-2.5">
                <div className="truncate text-sm font-semibold">@{c.name}</div>
                <div className="text-xs text-white/50">
                  {c.clip_count} clip{c.clip_count === 1 ? "" : "s"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
