import Link from "next/link";
import ShortsGrid from "@/components/shorts-grid";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// All 18+ clips whose caption carries #tag, as a grid; tapping a tile opens the
// immersive 18+ feed scoped to the same tag. The section layout gates access.
export default async function Shorts18TagPage(props: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: raw } = await props.params;
  const session = await getSession();
  const tag = decodeURIComponent(raw).replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-6">
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <h1 className="text-lg font-semibold text-white">#{tag}</h1>
        {/* Back to the catalogue this category came from. */}
        <Link href="/shorts18/tags" className="text-sm text-white/50 hover:text-white/80">
          All categories
        </Link>
      </div>
      <ShortsGrid
        query={{ channel: "18plus", tag }}
        hrefPrefix={`/shorts18?tag=${encodeURIComponent(tag)}&focus=`}
        empty="No clips with this hashtag yet."
        categoryEditable={session?.role === "admin"}
      />
    </div>
  );
}
