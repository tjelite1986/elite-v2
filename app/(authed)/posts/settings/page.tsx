import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getProfileByUserId } from "@/lib/profiles";
import PostsImportButton from "@/components/posts-import-button";
import PostsDuplicates from "@/components/posts-duplicates";
import InstagramAutoConnect from "@/components/instagram-auto-connect";

export const dynamic = "force-dynamic";

// Posts settings — per-user drop folder for everyone granted access; shared
// creator import / dedup / Instagram tools stay admin-only. Visible only to a
// user the admin granted the `posts_settings` permission (admins always).
export default async function PostsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "posts_settings")) redirect("/posts");
  const isAdmin = session.role === "admin";
  const username = getProfileByUserId(Number(session.sub))?.username ?? null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-16 text-white">
      <h1 className="mb-6 text-lg font-semibold">Settings</h1>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">Your import folder</h2>
        <p className="mb-2 text-sm text-white/50">
          Drop images into your personal folder and each imports as your own post:
        </p>
        <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          _import/u_{username ?? `…`}/posts/
        </code>
        <p className="text-sm text-white/50">
          Name a file{" "}
          <code className="text-white/70">caption [h_tag].jpg</code> (or drop a{" "}
          <code className="text-white/70">.md</code> sidecar) to set its caption
          and hashtags.
        </p>
      </section>

      {isAdmin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Shared import folder (admin)</h2>
          <p className="mb-3 text-sm text-white/50">
            Drop files named{" "}
            <code className="text-white/70">creator_-_title.jpg</code> (or a
            subfolder named after the creator) into the shared import folder, then
            sort them in. Videos route to Shorts under the same handle. The host
            timer runs this automatically.
          </p>
          <PostsImportButton />
        </section>
      )}

      {isAdmin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Instagram sync</h2>
          <p className="text-sm text-white/50">
            Connect an Instagram account on a person’s profile (Edit profile →
            Instagram) and use “Sync from Instagram” there to import their photos
            as posts and videos as shorts. Or auto-connect every creator folder
            whose name is a real Instagram account (100% match):
          </p>
          <InstagramAutoConnect />
        </section>
      )}

      {isAdmin && <PostsDuplicates />}
    </div>
  );
}
