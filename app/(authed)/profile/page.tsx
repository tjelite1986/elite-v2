import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getUserById } from "@/lib/auth";

function getInitials(email: string): string {
  const local = email.split("@")[0] || email;
  const letters = local.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || local.slice(0, 2)).toUpperCase();
}

function formatDate(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = getUserById(Number(session.sub));
  if (!user) redirect("/login");

  return (
    <main className="text-white px-8 pb-8 pt-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <Link href="/" className="text-sm text-white/60 hover:text-white">
            ← Back
          </Link>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-semibold">
              {getInitials(user.email)}
            </div>
            <div>
              <div className="text-xl font-medium">{user.email}</div>
              <div className="mt-1 inline-flex rounded-full bg-white/10 px-3 py-0.5 text-xs text-white/70">
                {user.role === "admin" ? "Administrator" : "Member"}
              </div>
            </div>
          </div>

          <dl className="mt-8 divide-y divide-white/10 text-sm">
            <div className="flex justify-between py-3">
              <dt className="text-white/50">Email</dt>
              <dd className="text-white/90">{user.email}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-white/50">Role</dt>
              <dd className="text-white/90 capitalize">{user.role}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-white/50">Member since</dt>
              <dd className="text-white/90">{formatDate(user.created_at)}</dd>
            </div>
          </dl>

          <div className="mt-8">
            <Link
              href="/settings"
              className="inline-flex rounded-full bg-white/15 px-5 py-2 text-sm font-medium hover:bg-white/25 transition"
            >
              Account settings
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
