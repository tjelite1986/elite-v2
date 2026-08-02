import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PerformersBrowser from "@/components/performers-browser";

export const dynamic = "force-dynamic";

// Performer index. The section layout enforces the 18+ gate; the API re-checks.
export default async function PerformersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <PerformersBrowser />;
}
