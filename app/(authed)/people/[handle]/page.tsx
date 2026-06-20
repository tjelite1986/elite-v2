import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { has18Access } from "@/lib/shorts-gate";
import { resolvePerson } from "@/lib/directory";
import PersonProfile from "@/components/person-profile";

export const dynamic = "force-dynamic";

// Unified cross-section profile for a handle (user and/or mirrored creator).
export default async function PersonPage({
  params,
}: {
  params: { handle: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewerId = Number(session.sub);
  ensureUserProfile(viewerId, session.email);

  // An explicitly-navigated profile's 18+ tab shows whenever the PIN is unlocked
  // (you came to this person on purpose). The "show 18+ everywhere" preference
  // governs only general surfaces (home/explore feeds, the people directory).
  const include18 = await has18Access();

  const person = resolvePerson(
    decodeURIComponent(params.handle),
    viewerId,
    include18
  );
  if (!person) notFound();

  return <PersonProfile person={person} isAdmin={session.role === "admin"} />;
}
