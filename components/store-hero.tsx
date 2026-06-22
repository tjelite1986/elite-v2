import Link from "next/link";
import type { AppCard } from "@/lib/store";

// Featured banner strip at the top of Discover. Uses each app's banner image.
export default function StoreHero({ apps }: { apps: AppCard[] }) {
  if (apps.length === 0) return null;
  return (
    <div className="mb-6 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {apps.map((app) => (
        <Link
          key={app.id}
          href={`/store/${app.slug}`}
          className="relative flex h-44 w-[85vw] max-w-md shrink-0 items-end overflow-hidden rounded-3xl ring-1 ring-white/10"
        >
          {app.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.bannerUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="relative flex items-center gap-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={app.iconUrl}
              alt=""
              className="h-14 w-14 rounded-xl ring-1 ring-white/20"
              loading="lazy"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                {app.editorsChoice ? "Editor's Choice" : "Featured"}
              </p>
              <p className="truncate text-lg font-bold text-white">{app.name}</p>
              <p className="truncate text-xs text-white/70">
                {app.tagline || app.developer || app.category}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
