import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive 18+ feed scoped to a person handle (opened from the unified
// profile's 18+ tab). Access is gated by the shorts18 section layout.
export default async function Person18WatchPage(
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
      channel="18plus"
      basePath="/shorts18"
      handle={decodeURIComponent(params.handle)}
      focusId={focus && !isNaN(focus) ? focus : undefined}
      isAdmin={session.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
