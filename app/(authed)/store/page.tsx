import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getDiscover } from "@/lib/store";
import StoreHero from "@/components/store-hero";
import StoreShelf from "@/components/store-shelf";
import StoreAdultToggle from "@/components/store-adult-toggle";

export const dynamic = "force-dynamic";

export default async function StoreDiscoverPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const adult = await has18Access();
  const { hero, shelves } = getDiscover(Number(session.sub), adult);

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
      <h1 className="mb-4 px-1 text-2xl font-bold">App Store</h1>
      <StoreAdultToggle unlocked={adult} />
      <StoreHero apps={hero} />
      {shelves.map((shelf) => (
        <StoreShelf
          key={shelf.key}
          shelf={shelf}
          seeAllHref={
            shelf.key.startsWith("cat-")
              ? `/store/category/${encodeURIComponent(shelf.title)}`
              : shelf.key === "games"
                ? `/store/search?section=games`
                : undefined
          }
        />
      ))}
      {shelves.length === 0 && (
        <p className="py-16 text-center text-sm text-white/40">
          The catalog is empty. An admin can populate it from the archive in
          Manage.
        </p>
      )}
    </div>
  );
}
