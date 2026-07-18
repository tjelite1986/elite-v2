import ShortsFeed from "@/components/shorts-feed";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ShortsPage(
  props: {
    searchParams: Promise<{ focus?: string; tag?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const focus = Number(searchParams?.focus);
  const tag = searchParams?.tag?.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "") || undefined;
  return (
    <ShortsFeed
      channel="main"
      focusId={focus && !isNaN(focus) ? focus : undefined}
      tag={tag}
      isAdmin={session?.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
