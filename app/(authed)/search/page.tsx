import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SearchClient from "@/components/search-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search - Elite" };

// ?q= seeds the box, so the dashboard's "See all results" link lands on a page
// that is already showing the same query's hits.
export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { q } = await props.searchParams;
  return <SearchClient initialQuery={q ?? ""} />;
}
