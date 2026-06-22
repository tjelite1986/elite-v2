import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ShortsGrab from "@/components/shorts-grab";

export const dynamic = "force-dynamic";

// Grab from web: paste a link from a supported site, pull the clip(s) into a
// channel's import folder and import them. Admin only.
export default async function ShortsGrabPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/shorts");

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-16 text-white">
      <h1 className="mb-1 text-lg font-semibold">Grab from web</h1>
      <p className="mb-5 text-sm text-white/50">
        Paste a video or profile link. Clips are saved into the chosen channel and
        imported into the library automatically.
      </p>
      <ShortsGrab />
    </div>
  );
}
