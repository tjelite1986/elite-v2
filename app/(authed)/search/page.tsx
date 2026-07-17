import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SearchClient from "@/components/search-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search - Elite" };

export default async function SearchPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <SearchClient />;
}
