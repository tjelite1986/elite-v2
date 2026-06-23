import ShortsFeed from "@/components/shorts-feed";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ShortsPage({
  searchParams,
}: {
  searchParams: { focus?: string };
}) {
  const session = await getSession();
  const focus = Number(searchParams?.focus);
  return (
    <ShortsFeed
      channel="main"
      focusId={focus && !isNaN(focus) ? focus : undefined}
      isAdmin={session?.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
