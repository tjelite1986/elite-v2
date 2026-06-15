import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SettingsClient from "@/components/settings-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <SettingsClient isAdmin={session.role === "admin"} />;
}
