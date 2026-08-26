import Link from "next/link";
import { redirect } from "next/navigation";
import { Store } from "lucide-react";

// The App Store is its own app now (its own repo, its own container, its own
// library on disk) — this page is all that is left of the section that used to
// live here: the hop that takes "App Store" in the menu to wherever that app
// is running. APPSTORE_URL is set in compose, so moving the store to another
// host is a config change and not a code change.
//
// It needs no token: the store verifies the same `elite_session` cookie
// against this app's /api/auth/verify, so whoever is signed in here is signed
// in there.
export const dynamic = "force-dynamic";

export default function StoreRedirectPage() {
  const url = process.env.APPSTORE_URL?.trim();
  if (url) redirect(url);

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-24 text-white">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <Store size={28} className="mx-auto mb-3 text-white/50" />
        <h1 className="text-lg font-semibold">App Store not connected</h1>
        <p className="mt-2 text-sm text-white/60">
          The store runs as its own app. Point{" "}
          <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">
            APPSTORE_URL
          </code>{" "}
          at it and this link opens it.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
