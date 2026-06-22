import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listSaved } from "@/lib/store";
import StoreGrid from "@/components/store-grid";

export const dynamic = "force-dynamic";

export default async function StoreSavedPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const apps = listSaved(Number(session.sub));

  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-28 text-white">
      <h1 className="mb-4 px-1 text-2xl font-bold">Saved</h1>
      <StoreGrid apps={apps} />
    </div>
  );
}
