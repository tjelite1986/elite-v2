import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

// Your own uploaded clips (public + private) on the 18+ channel.
export default function My18ShortsPage() {
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16">
      <ShortsGrid
        query={{ channel: "18plus", mine: "1" }}
        hrefPrefix="/shorts18?focus="
        empty="You haven't uploaded any 18+ shorts yet."
      />
    </div>
  );
}
