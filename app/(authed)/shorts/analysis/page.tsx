import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { analysedShorts } from "@/lib/short-summary";
import ShortAnalysis from "@/components/short-analysis";

export const dynamic = "force-dynamic";

export default async function ShortAnalysisPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <ShortAnalysis shorts={analysedShorts("main")} basePath="/shorts" />
  );
}
