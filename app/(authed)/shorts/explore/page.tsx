import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

// Browse all clips as a grid; tapping one opens the immersive feed there.
export default function ExplorePage() {
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16">
      <ShortsGrid
        query={{ channel: "main" }}
        hrefPrefix="/shorts?focus="
        empty="Nothing to explore yet."
      />
    </div>
  );
}
