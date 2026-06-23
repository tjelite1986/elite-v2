import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

// Your own uploaded clips (public + private) on the main channel. Tapping one
// opens the immersive feed there, where the visibility toggle lives.
export default function MyShortsPage() {
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16">
      <ShortsGrid
        query={{ channel: "main", mine: "1" }}
        hrefPrefix="/shorts?focus="
        empty="You haven't uploaded any shorts yet."
      />
    </div>
  );
}
