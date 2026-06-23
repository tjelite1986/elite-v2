import ShortsFeed from "@/components/shorts-feed";
import ShortsCategoryChips from "@/components/shorts-category-chips";
import { getSession } from "@/lib/auth";
import { parseCategory } from "@/lib/shorts-categories";

export const dynamic = "force-dynamic";

// Videos: the immersive 18+ feed. The section layout already gated access.
// The category chips (under the tab bar) filter the feed via the `cat` param.
export default async function Shorts18Page({
  searchParams,
}: {
  searchParams: { focus?: string; cat?: string };
}) {
  const session = await getSession();
  const focus = Number(searchParams?.focus);
  const category = parseCategory(searchParams?.cat);
  return (
    <>
      <div
        data-immersive-hide
        className="fixed left-1/2 top-[5.75rem] z-30 max-w-[96vw] -translate-x-1/2"
      >
        <ShortsCategoryChips className="rounded-full bg-black/50 px-2 py-1 backdrop-blur ring-1 ring-white/10" />
      </div>
      <ShortsFeed
        key={category ?? "all"}
        channel="18plus"
        basePath="/shorts18"
        category={category ?? undefined}
        focusId={focus && !isNaN(focus) ? focus : undefined}
        isAdmin={session?.role === "admin"}
      />
    </>
  );
}
