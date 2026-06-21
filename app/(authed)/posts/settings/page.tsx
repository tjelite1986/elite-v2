import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PostsImportButton from "@/components/posts-import-button";
import PostsDuplicates from "@/components/posts-duplicates";
import InstagramAutoConnect from "@/components/instagram-auto-connect";

export const dynamic = "force-dynamic";

// Posts settings: admin tools for the photo library — import-folder sorting and
// the duplicate scanner. Mirrors the Shorts settings page.
export default async function PostsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isAdmin = session.role === "admin";

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-16 text-white">
      <h1 className="mb-6 text-lg font-semibold">Settings</h1>

      {!isAdmin && (
        <p className="text-sm text-white/40">No settings available.</p>
      )}

      {isAdmin && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Import folder</h2>
          <p className="mb-3 text-sm text-white/50">
            Drop files named{" "}
            <code className="text-white/70">creator_-_title.jpg</code> (or a
            subfolder named after the creator) into the import folder, then sort
            them in. Videos route to Shorts under the same handle. The host timer
            runs this automatically.
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
