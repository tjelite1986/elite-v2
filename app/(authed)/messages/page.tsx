import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import MessengerClient from "@/components/messenger-client";

export default async function MessagesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <MessengerClient meId={Number(session.sub)} />;
}
