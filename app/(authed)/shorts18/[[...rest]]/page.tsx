import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The 18+ shorts library moved to its own app on 2026-09-15, the way the main
// channel moved before it. Every old link — a bookmark, the PWA's start URL, a
// shared clip — lands there instead of a 404 here.
//
// An absolute redirect to another host, so it has to come from the environment:
// hard-coding a hostname in a page is how a deployment fact ends up in a repo.
// Unset means the section simply closes and the visitor is returned to the home
// page, rather than bounced somewhere that may not exist.
export default async function RetiredShorts18Page(props: {
  params: Promise<{ rest?: string[] }>;
}) {
  await props.params;
  redirect(process.env.ADSHORTIS_URL || "/");
}
