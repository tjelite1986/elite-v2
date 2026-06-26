import Link from "next/link";
import { redirect } from "next/navigation";
import { Upload } from "lucide-react";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getProfileByUserId } from "@/lib/profiles";
import ShortsAdmin from "@/components/shorts-admin";
import ShortsImportButton from "@/components/shorts-import-button";
import ShortsDuplicates from "@/components/shorts-duplicates";
import ShortsCleanup from "@/components/shorts-cleanup";
import ShortsTitleFetch from "@/components/shorts-title-fetch";

export const dynamic = "force-dynamic";

// Shorts settings — per-user (own upload + own drop folder). Visible only to a
// user the admin granted the `shorts_settings` permission (admins always).
// Shared library tools (auto-poll, shared import, dedup) stay admin-only.
export default async function ShortsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "shorts_settings")) redirect("/shorts");
  const isAdmin = session.role === "admin";
  const username = getProfileByUserId(Number(session.sub))?.username ?? null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-16 text-white">
      <section className="mb-8">
        <h1 className="mb-3 text-lg font-semibold">Upload</h1>
        <Link
          href="/shorts/upload"
          className="flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95"
        >
          <Upload size={16} /> Upload a short
        </Link>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">Your import folder</h2>
        <p className="mb-2 text-sm text-white/50">
          Drop video files into your personal folder and they import as your own
          clips:
        </p>
        <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          _import/u_{username ?? `…`}/shorts/
        </code>
        <p className="text-sm text-white/50">
          Name a file{" "}
          <code className="text-white/70">title [h_tag][f_collection].mp4</code>{" "}
          to set its caption, hashtags and playlist. Drop into a subfolder to put
          it in that playlist.
        </p>
      </section>

      {isAdmin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Shared import folder (admin)</h2>
          <p className="mb-3 text-sm text-white/50">
            Drop files named{" "}
            <code className="text-white/70">profile_-_title.mp4</code> into the
            shared creator import folder, then sort them in. Everything before{" "}
            <code className="text-white/70">_-_</code> becomes the profile name.
            Unnamed files land under a fallback profile — open the profile and
            use the move button on a clip to reassign it afterwards.
          </p>
          <ShortsImportButton channel="main" />
        </section>
      )}

      {isAdmin && <ShortsDuplicates channel="main" />}

      {isAdmin && <ShortsCleanup channel="main" />}

      {isAdmin && <ShortsTitleFetch channel="main" />}

      {isAdmin && <ShortsAdmin channel="main" basePath="/shorts" />}
    </div>
  );
}
