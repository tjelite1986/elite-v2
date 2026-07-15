import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import MessagesShell from "@/components/messages-shell";

export default async function MessagesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);

  return (
    <MessagesShell
      meId={Number(session.sub)}
      myUsername={profile.username}
      myEmail={session.email}
    />
  );
}
