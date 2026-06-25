import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Images,
  Clapperboard,
  HardDrive,
  Users,
  MessageCircle,
  Store,
  ArrowRight,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { qb, getOne, getAll } from "@/lib/kysely";

export const dynamic = "force-dynamic";

function formatBytes(b: number): string {
  if (!b) return "0 MB";
  const gb = b / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(b / 1e6))} MB`;
}

// Protected landing page. The macOS menu bar comes from the (authed) layout.
// A small "home" surface: at-a-glance library stats, the most recent photos,
// and quick links into the main sections — scoped to the current user
// (session.sub is the effective account, so admin "act-as" sees that account).
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = Number(session.sub);

  const photo = getOne<{ n: number; bytes: number | null }>(
    qb
      .selectFrom("gallery_items")
      .select((eb) => [
        eb.fn.countAll<number>().as("n"),
        eb.fn.sum<number>("size_bytes").as("bytes"),
      ])
      .where("user_id", "=", userId)
      .where("is_deleted", "=", 0)
  );
  const short = getOne<{ n: number; bytes: number | null }>(
    qb
      .selectFrom("shorts")
      .select((eb) => [
        eb.fn.countAll<number>().as("n"),
        eb.fn.sum<number>("size_bytes").as("bytes"),
      ])
      .where("uploader_id", "=", userId)
      .where("channel", "=", "main")
      .where("is_deleted", "=", 0)
  );
  const recent = getAll<{ id: number; media_version: number }>(
    qb
      .selectFrom("gallery_items")
      .select(["id", "media_version"])
      .where("user_id", "=", userId)
      .where("is_deleted", "=", 0)
      .orderBy("uploaded_at", "desc")
      .limit(8)
  );

  const profile = getOne<{ username: string; display_name: string | null }>(
    qb
      .selectFrom("user_profiles")
      .select(["username", "display_name"])
      .where("user_id", "=", userId)
  );

  const photoCount = photo?.n ?? 0;
  const shortCount = short?.n ?? 0;
  const storage = (photo?.bytes ?? 0) + (short?.bytes ?? 0);
  // Greet with the public handle / display name, never the email (which is PII).
  const name = profile?.display_name || profile?.username || "there";

  const stats = [
    { icon: <Images size={18} />, label: "Photos", value: photoCount.toLocaleString(), href: "/gallery" },
    { icon: <Clapperboard size={18} />, label: "Shorts", value: shortCount.toLocaleString(), href: "/shorts" },
    { icon: <HardDrive size={18} />, label: "Storage", value: formatBytes(storage), href: "/gallery" },
  ];
  const links = [
    { icon: <Images size={20} />, label: "Photos", href: "/gallery" },
    { icon: <Clapperboard size={20} />, label: "Shorts", href: "/shorts" },
    { icon: <Users size={20} />, label: "People", href: "/people" },
    { icon: <MessageCircle size={20} />, label: "Messages", href: "/messages" },
    { icon: <Store size={20} />, label: "App Store", href: "/store" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-20 text-white md:pt-24">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back, {name}</h1>
        <p className="mt-1 text-sm text-white/50">Here&apos;s what&apos;s in your library.</p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 transition hover:bg-white/10"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/80">
              {s.icon}
            </span>
            <span>
              <span className="block text-2xl font-semibold leading-tight">{s.value}</span>
              <span className="block text-xs text-white/50">{s.label}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Recently added</h2>
          <Link
            href="/gallery"
            className="flex items-center gap-1 text-xs text-white/50 transition hover:text-white"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {recent.length > 0 ? (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {recent.map((it) => (
              <Link
                key={it.id}
                href="/gallery"
                className="aspect-square overflow-hidden rounded-xl bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/gallery/${it.id}/media?variant=thumb&v=${it.media_version}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-10 text-center">
            <p className="text-sm text-white/50">No photos yet.</p>
            <Link
              href="/gallery"
              className="mt-1 inline-block text-sm font-medium text-white/80 hover:text-white"
            >
              Upload your first &rarr;
            </Link>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-white/80">Jump back in</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 px-3 py-5 text-center transition hover:bg-white/10"
            >
              <span className="text-white/80">{l.icon}</span>
              <span className="text-xs font-medium text-white/70">{l.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
