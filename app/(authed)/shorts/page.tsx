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
  // "For You" is the default. Tag views stay chronological. A focus deep-link
  // downgrades ONLY the offset-paginated modes (foryou/random) to "new" — those
  // can't anchor a clip; the id-ordered modes (new/following/liked) keep their
  // mode, so Back / reload restores the feed the user was actually in.
  const requested = searchParams?.sort ? parseShortsSort(searchParams.sort) : null;
  const offsetSort = requested === "foryou" || requested === "random";
  const sort = tag
    ? ("new" as const)
    : requested === null
      ? hasFocus
        ? ("new" as const)
        : ("foryou" as const)
      : hasFocus && offsetSort
        ? ("new" as const)
        : requested;
  return (
    <ShortsFeed
      key={sort + ":" + (tag ?? "")}
      channel="main"
      focusId={hasFocus ? focus : undefined}
      tag={tag}
      sort={sort}
      showModeSelector={!tag && !(hasFocus && (requested === null || offsetSort))}
      isAdmin={session?.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
