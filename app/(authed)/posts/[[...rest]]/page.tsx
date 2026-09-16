import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The posts library moved to its own app on 2026-09-16, the way the shorts
// channels moved before it. Every old link — a bookmark, a shared post, a
// notification written while this app still served them — lands there instead
// of a 404 here.
//
// An absolute redirect to another host, so it has to come from the environment:
// hard-coding a hostname in a page is how a deployment fact ends up in a repo.
// Unset means the section simply closes and the visitor is returned to the home
// page, rather than bounced somewhere that may not exist.
//
// The rest of the path is carried across rather than dropped. Elitogram serves
// these pages at the root — /posts/p/12 is /p/12 there — so stripping this
// app's prefix lands the visitor on the post they asked for instead of on a
// feed they then have to search.
export default async function RetiredPostsPage(props: {
  params: Promise<{ rest?: string[] }>;
}) {
  const { rest } = await props.params;
  const base = process.env.ELITOGRAM_URL;
  if (!base) redirect("/");
  const tail = (rest ?? []).map(encodeURIComponent).join("/");
  redirect(tail ? `${base}/${tail}` : base);
}
