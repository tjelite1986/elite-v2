import Link from "next/link";
import type { Shelf } from "@/lib/store";
import StoreAppCard from "@/components/store-app-card";

// A horizontal, snap-scrolling row of app cards (App Store "shelf").
export default function StoreShelf({
  shelf,
  seeAllHref,
}: {
  shelf: Shelf;
  seeAllHref?: string;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-lg font-bold text-white">{shelf.title}</h2>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="text-xs font-medium text-sky-400 hover:text-sky-300"
          >
            See all
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shelf.apps.map((app) => (
          <StoreAppCard key={app.id} app={app} variant="tile" />
        ))}
      </div>
    </section>
  );
}
