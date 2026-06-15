import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Protected landing page. The macOS menu bar comes from the (authed) layout.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center text-center text-white">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight drop-shadow-lg">
          Elite v2
        </h1>
        <p className="mt-3 text-lg text-white/80">
          Signed in as {session.email}
          {session.role === "admin" && " (admin)"}.
        </p>
      </div>
    </div>
  );
}
