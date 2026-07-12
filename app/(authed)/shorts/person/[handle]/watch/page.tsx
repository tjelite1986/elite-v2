import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive feed scoped to a person handle — the same scope as the unified
// profile's Shorts tab (profile clips + owner uploads across linked members),
// so a tapped tile always starts at that exact clip.
export default async function PersonWatchPage(
  props: {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ focus?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) redirect("/login");

  const focus = Number(searchParams?.focus);
  return (
    <ShortsFeed
      channel="main"
      handle={decodeURIComponent(params.handle)}
      focusId={focus && !isNaN(focus) ? focus : undefined}
      isAdmin={session.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
