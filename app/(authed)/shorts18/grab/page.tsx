import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ShortsGrab from "@/components/shorts-grab";

export const dynamic = "force-dynamic";

// Grab from web: paste a link from a supported site, pull the clip(s) into the
// 18+ import folder and import them. Admin only. (The main channel moved to
// tikshortis on 2026-08-31 and grabs for itself.)
export default async function ShortsGrabPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/shorts18");

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 text-white">
      <h1 className="mb-1 text-lg font-semibold">Grab from web</h1>
      <p className="mb-5 text-sm text-white/50">
        Paste a video or profile link. Clips are saved into the 18+ library and
        imported automatically.
      </p>
      <ShortsGrab />
    </div>
  );
}
