import ShortsFeed from "@/components/shorts-feed";
import { getSession } from "@/lib/auth";
import { parseShortsSort } from "@/lib/shorts";
import { parseCategory } from "@/lib/shorts-categories";

export const dynamic = "force-dynamic";

// Videos: the immersive 18+ feed. The section layout already gated access.
// The genre filter lives in the player's 3-dot menu (the old chips bar is
// gone); it scopes the feed via the `cat` param.
export default async function Shorts18Page(
  props: {
    searchParams: Promise<{ focus?: string; cat?: string; tag?: string; sort?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const focus = Number(searchParams?.focus);
  const hasFocus = Boolean(focus && !isNaN(focus));
  const category = parseCategory(searchParams?.cat);
  const tag = searchParams?.tag?.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "") || undefined;
  // "For You" is the default; a focus deep-link needs the chronological feed
  // (its pagination cuts on ids). Tag views stay chronological too.
  const sort =
    hasFocus || tag
      ? ("new" as const)
      : searchParams?.sort
        ? parseShortsSort(searchParams.sort)
        : ("foryou" as const);
  return (
    <ShortsFeed
      key={(category ?? "all") + ":" + (tag ?? "") + ":" + sort}
      channel="18plus"
      basePath="/shorts18"
      category={category ?? undefined}
      tag={tag}
      sort={sort}
      showModeSelector={!tag && !hasFocus}
      focusId={hasFocus ? focus : undefined}
      isAdmin={session?.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
