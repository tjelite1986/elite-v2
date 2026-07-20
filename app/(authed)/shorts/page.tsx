import ShortsFeed from "@/components/shorts-feed";
import { getSession } from "@/lib/auth";
import { parseShortsSort } from "@/lib/shorts";

export const dynamic = "force-dynamic";

export default async function ShortsPage(
  props: {
    searchParams: Promise<{ focus?: string; tag?: string; sort?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const focus = Number(searchParams?.focus);
  const hasFocus = Boolean(focus && !isNaN(focus));
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
      key={sort + ":" + (tag ?? "")}
      channel="main"
      focusId={hasFocus ? focus : undefined}
      tag={tag}
      sort={sort}
      showModeSelector={!tag && !hasFocus}
      isAdmin={session?.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
