import ShortsGrid from "@/components/shorts-grid";
import ShortsCategoryChips from "@/components/shorts-category-chips";
import { getSession } from "@/lib/auth";
import { parseCategory } from "@/lib/shorts-categories";

export const dynamic = "force-dynamic";

// Browse all 18+ clips as a grid, filterable by category. Admins get a per-tile
// category selector to sort uncategorized imports.
export default async function Explore18Page({
  searchParams,
}: {
  searchParams: { cat?: string };
}) {
  const session = await getSession();
  const category = parseCategory(searchParams?.cat);
  const query: Record<string, string> = { channel: "18plus" };
  if (category) query.category = category;

  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16">
      <div className="mb-3 px-1">
        <ShortsCategoryChips />
      </div>
      <ShortsGrid
        key={category ?? "all"}
        query={query}
        hrefPrefix={
          category ? `/shorts18?cat=${category}&focus=` : "/shorts18?focus="
        }
        empty="Nothing here yet."
        categoryEditable={session?.role === "admin"}
      />
    </div>
  );
}
