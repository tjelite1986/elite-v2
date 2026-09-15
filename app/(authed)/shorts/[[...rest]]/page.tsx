import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The main shorts channel moved to tikshortis on 2026-08-31 and its last clips
// left this app on 2026-09-15 — elite-v2 is 18+-only now. Every old /shorts
// link (bookmarks, the PWA's start URL, a shared clip URL) lands on the 18+
// library instead of a 404.
export default async function RetiredShortsPage(props: {
  params: Promise<{ rest?: string[] }>;
}) {
  await props.params;
  redirect("/shorts18");
}
