import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { listCategories } from "@/lib/store";
import StoreSearch from "@/components/store-search";
import StoreAdultToggle from "@/components/store-adult-toggle";

export const dynamic = "force-dynamic";

export default async function StoreSearchPage({
  searchParams,
}: {
  searchParams: { q?: string; section?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const adult = await has18Access();
  const categories = listCategories(adult);

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
      <h1 className="mb-4 px-1 text-2xl font-bold">Search</h1>
      <StoreAdultToggle unlocked={adult} />
      <StoreSearch
        initialQuery={searchParams.q || ""}
        initialSection={searchParams.section || ""}
        categories={categories}
      />
    </div>
  );
}
