import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

// All main-channel clips whose caption carries #tag, as a grid; tapping a tile
// opens the immersive feed scoped to the same tag.
export default async function ShortsTagPage(props: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: raw } = await props.params;
  const tag = decodeURIComponent(raw).replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-6">
      <h1 className="mb-3 px-1 text-lg font-semibold text-white">#{tag}</h1>
      <ShortsGrid
        query={{ channel: "main", tag }}
        hrefPrefix={`/shorts?tag=${encodeURIComponent(tag)}&focus=`}
        empty="No clips with this hashtag yet."
      />
    </div>
  );
}
