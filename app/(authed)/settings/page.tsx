import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import SettingsClient from "@/components/settings-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);

  return (
    <SettingsClient
      isAdmin={session.role === "admin"}
      showAdultOutside={Boolean(profile.show_adult_outside)}
    />
  );
}
