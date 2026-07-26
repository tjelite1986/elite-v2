import ShortsGrid from "@/components/shorts-grid";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Browse all clips as a grid; tapping one opens the immersive feed there.
export default async function ExplorePage() {
  const session = await getSession();
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-6">
      <ShortsGrid
        query={{ channel: "main" }}
        hrefPrefix="/shorts?focus="
        empty="Nothing to explore yet."
        restoreKey="explore:main"
        lengthFilter
        isAdmin={session?.role === "admin"}
      />
    </div>
  );
}
