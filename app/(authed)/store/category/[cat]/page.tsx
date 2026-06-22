import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { searchApps } from "@/lib/store";
import StoreGrid from "@/components/store-grid";

export const dynamic = "force-dynamic";

export default async function StoreCategoryPage({
  params,
}: {
  params: { cat: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const category = decodeURIComponent(params.cat);
  const apps = searchApps(Number(session.sub), await has18Access(), {
    category,
    sort: "rating",
  });

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
      <h1 className="mb-4 px-1 text-2xl font-bold">{category}</h1>
      <StoreGrid apps={apps} />
    </div>
  );
}
