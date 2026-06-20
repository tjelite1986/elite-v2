import Link from "next/link";
import { getCreators } from "@/lib/shorts";
import { handleOf } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Grid of creators (auto-poll profiles + uploaders) with a cover thumbnail.
export default function ProfilesPage() {
  const creators = getCreators("main");

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-16 text-white">
      <h1 className="mb-4 px-1 text-lg font-semibold">Profiles</h1>
      {creators.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/50">No profiles yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {creators.map((c) => (
            <div
              key={c.id}
              className="overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              {/* Poster opens the clips; the name opens the unified profile. */}
              <Link href={`/shorts/profile/${c.id}`} className="block">
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
              </Link>
              <div className="p-2.5">
                <Link
                  href={`/people/${handleOf(c.name)}`}
                  className="block truncate text-sm font-semibold hover:underline"
                >
                  @{c.name}
                </Link>
                <div className="text-xs text-white/50">
                  {c.clip_count} clip{c.clip_count === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
