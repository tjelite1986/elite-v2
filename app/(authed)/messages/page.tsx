import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { showsAppstore } from "@/lib/permissions";
import MessagesShell from "@/components/messages-shell";

export default async function MessagesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);

  return (
    <MessagesShell
      meId={Number(session.sub)}
      myUsername={profile.username}
      myDisplayName={profile.display_name}
      myEmail={session.email}
      isAdmin={session.role === "admin"}
      showAppstore={showsAppstore(session)}
    />
  );
}
