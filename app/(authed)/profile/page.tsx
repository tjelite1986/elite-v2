import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";

// The account's own profile is the unified /people/<username> page (the same
// profile everyone else sees). This route stays only as a redirect so old links
// and bookmarks to /profile still land there.
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { username } = ensureUserProfile(Number(session.sub), session.email);
  redirect(`/people/${username}`);
}
