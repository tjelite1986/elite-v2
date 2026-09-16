import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The people directory described the posts library — who posted what, which
// handles belong to the same person — so it left with it on 2026-09-16. See the
// sibling /posts route for why the address comes from the environment.
//
// Elitogram serves this one at the same path, so the whole path is carried
// across unchanged.
export default async function RetiredPeoplePage(props: {
  params: Promise<{ rest?: string[] }>;
}) {
  const { rest } = await props.params;
  const base = process.env.ELITOGRAM_URL;
  if (!base) redirect("/");
  const tail = (rest ?? []).map(encodeURIComponent).join("/");
  redirect(tail ? `${base}/people/${tail}` : `${base}/people`);
}
