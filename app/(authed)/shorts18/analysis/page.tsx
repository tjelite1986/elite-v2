import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { analysedShorts } from "@/lib/short-summary";
import ShortAnalysis from "@/components/short-analysis";

export const dynamic = "force-dynamic";

// The section layout already gates this, but the page re-checks: the summaries
// describe the clips, so this must not become a way around the PIN if the
// layout is ever refactored.
export default async function Short18AnalysisPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await has18Access())) notFound();

  return (
    <ShortAnalysis shorts={analysedShorts("18plus")} basePath="/shorts18" />
  );
}
