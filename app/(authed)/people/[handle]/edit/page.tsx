import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ensureUserProfile, getProfileExtras } from "@/lib/profiles";
import { has18Access } from "@/lib/shorts-gate";
import { resolvePerson } from "@/lib/directory";
import ProfileExtrasEditor from "@/components/profile-extras-editor";

export const dynamic = "force-dynamic";

// Edit a profile's bio / links / cover banner (own profile, or any for admins).
export default async function EditProfilePage({
  params,
}: {
  params: { handle: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewerId = Number(session.sub);
  ensureUserProfile(viewerId, session.email);

  const include18 = await has18Access();
  const person = resolvePerson(decodeURIComponent(params.handle), viewerId, include18);
  if (!person) notFound();
  if (!person.isOwn && session.role !== "admin") redirect(`/people/${person.handle}`);

  const extras = getProfileExtras(person.handle);

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-24 text-white">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/people/${person.handle}`}
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ChevronLeft size={16} /> Back
        </Link>
      </div>
      <h1 className="mb-5 text-lg font-semibold">Edit @{person.handle}</h1>
      <ProfileExtrasEditor
        handle={person.handle}
        initialBio={extras?.bio ?? person.bio ?? ""}
        initialLinks={person.links}
        hasBanner={person.hasBanner}
      />
    </div>
  );
}
