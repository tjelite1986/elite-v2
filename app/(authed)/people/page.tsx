import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PeopleDirectory from "@/components/people-directory";

export const dynamic = "force-dynamic";

// Cross-section people directory: every user + mirrored creator, with links to
// wherever they have content (Photos / Shorts / Shorts 18+).
export default async function PeoplePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return <PeopleDirectory />;
}
