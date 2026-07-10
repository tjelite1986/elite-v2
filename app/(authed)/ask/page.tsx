import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AskClient from "@/components/ask-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ask - Elite" };

export default async function AskPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AskClient />;
}
