import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Both shorts channels have left this app: main to its own app on 2026-08-31,
// 18+ on 2026-09-15. Every old /shorts link lands on the app that owns the
// library now — see the sibling /shorts18 route for why the address comes from
// the environment.
export default async function RetiredShortsPage(props: {
  params: Promise<{ rest?: string[] }>;
}) {
  await props.params;
  redirect(process.env.ADSHORTIS_URL || "/");
}
