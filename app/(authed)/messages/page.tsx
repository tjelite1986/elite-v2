import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import MessagesShell from "@/components/messages-shell";

export default async function MessagesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <MessagesShell meId={Number(session.sub)} />;
}
