import Shorts18Tabs from "@/components/shorts18-tabs";
import Shorts18Gate from "@/components/shorts-18-gate";
import { has18Access, getPin } from "@/lib/shorts-gate";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Shared chrome for the separate 18+ Shorts section. The whole section sits
// behind the PIN gate: until the gate cookie is valid, every page renders the
// PIN prompt instead of its content. Middleware enforces this independently for
// deep links, and each media/API route re-checks the gate too.
export default async function Shorts18Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await has18Access())) {
    return <Shorts18Gate configured={getPin() !== null} />;
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
