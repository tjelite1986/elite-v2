import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

// Convenience redirect to the viewer's own public profile.
export default async function PostsMePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);
  redirect(`/posts/u/${profile.username}`);
}
