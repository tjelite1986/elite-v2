import Shorts18Gate from "@/components/shorts-18-gate";
import { has18Access } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// Shared chrome for the 18+ long-form video section (VIDEOS_ROOT/adults). Same
// rule as the 18+ shorts section: open to every logged-in user unless they set a
// personal PIN, in which case the unlock prompt stands here. Each API/media
// route re-checks has18Access itself — this layout is never the only gate.
export default async function Videos18Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await has18Access())) {
    return <Shorts18Gate configured={true} />;
  }
  return <>{children}</>;
}
