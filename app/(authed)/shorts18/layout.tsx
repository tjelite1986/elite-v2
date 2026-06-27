import Shorts18Tabs from "@/components/shorts18-tabs";
import Shorts18Gate from "@/components/shorts-18-gate";
import { has18Access } from "@/lib/shorts-gate";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Shared chrome for the separate 18+ Shorts section. Open to all logged-in users
// by default; only a user who set a personal 18+ PIN sees the unlock prompt here
// until they enter it. Each media/API route re-checks has18Access too.
export default async function Shorts18Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await has18Access())) {
    // has18Access is only false here when the user HAS a personal PIN and hasn't
    // unlocked it this session.
    return <Shorts18Gate configured={true} />;
  }

  const session = await getSession();
  const canSettings = hasPermission(session, "shorts18_settings");
  return (
    <>
      <Shorts18Tabs canSettings={canSettings} />
      {children}
    </>
  );
}
