import Link from "next/link";
import { redirect } from "next/navigation";
import { Upload } from "lucide-react";
import { getSession } from "@/lib/auth";
import ShortsAdmin from "@/components/shorts-admin";
import ShortsDuplicates from "@/components/shorts-duplicates";
import ShortsTitleFetch from "@/components/shorts-title-fetch";

export const dynamic = "force-dynamic";

// Shorts settings: upload (everyone) + auto-poll profile management (admins).
export default async function ShortsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isAdmin = session.role === "admin";

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

      {isAdmin && <ShortsDuplicates channel="main" />}

      {isAdmin && <ShortsTitleFetch channel="main" />}

      {isAdmin && <ShortsAdmin channel="main" basePath="/shorts" />}
    </div>
  );
}
