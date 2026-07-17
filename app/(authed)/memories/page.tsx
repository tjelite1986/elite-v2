import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import MemoriesClient from "@/components/memories-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "On this day - Elite" };

export default async function MemoriesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <MemoriesClient />;
}
