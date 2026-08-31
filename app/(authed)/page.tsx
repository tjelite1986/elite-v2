import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Images,
  Clapperboard,
  HardDrive,
  Users,
  MessageCircle,
  Store,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { showsAppstore } from "@/lib/permissions";
import { APPSTORE_URL } from "@/lib/appstore-url";
import { qb, getOne, getAll } from "@/lib/kysely";
import WeatherWidget from "@/components/weather-widget";
import ServerWidget from "@/components/server-widget";
import ClockWidget from "@/components/clock-widget";
import DockerWidget from "@/components/docker-widget";
import WeekWidget from "@/components/week-widget";
import StorageDonut from "@/components/storage-donut";
import NotificationsWidget from "@/components/notifications-widget";
import HomeSearch from "@/components/home-search";

export const dynamic = "force-dynamic";

function formatBytes(b: number): string {
  if (!b) return "0 MB";
  const gb = b / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(b / 1e6))} MB`;
}

// Protected landing page. The macOS menu bar comes from the (authed) layout.
// A small "home" surface built to the Layout Studio sketch: time, week,
// weather, notifications, storage and quick links — scoped to the current user
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

  const profile = getOne<{ username: string; display_name: string | null }>(
    qb
      .selectFrom("user_profiles")
      .select(["username", "display_name"])
      .where("user_id", "=", userId)
  );

  const photoCount = photo?.n ?? 0;
  const shortCount = short?.n ?? 0;
  const storage = (photo?.bytes ?? 0) + (short?.bytes ?? 0);
  const storageSegments = [
    { label: "Photos", bytes: photo?.bytes ?? 0, colour: "#38bdf8" },
    { label: "Shorts", bytes: short?.bytes ?? 0, colour: "#a78bfa" },
  ];
  // Greet with the public handle / display name, never the email (which is PII).
  const name = profile?.display_name || profile?.username || "there";

  const stats = [
    { icon: <Images size={18} />, label: "Photos", value: photoCount.toLocaleString(), href: "/gallery" },
    { icon: <Clapperboard size={18} />, label: "Shorts", value: shortCount.toLocaleString(), href: "/shorts" },
    { icon: <HardDrive size={18} />, label: "Storage", value: formatBytes(storage), href: "/gallery" },
  ];
  // `hard` leaves the app: the store is its own site on its own host, so the
  // router has nothing to resolve — this is a real navigation off this origin.
  const links: {
    icon: React.ReactNode;
    label: string;
    href: string;
    hard?: boolean;
  }[] = [
    { icon: <Images size={20} />, label: "Photos", href: "/gallery" },
    { icon: <Clapperboard size={20} />, label: "Shorts", href: "/shorts" },
    { icon: <Users size={20} />, label: "People", href: "/people" },
    { icon: <MessageCircle size={20} />, label: "Messages", href: "/messages" },
  ];
  // Same two questions as the menu row — see showsAppstore(). Appended rather
  // than filtered out so the tile keeps its place at the end of the row.
  if (showsAppstore(session)) {
    links.push({
      icon: <Store size={20} />,
      label: "App Store",
      href: APPSTORE_URL,
      hard: true,
    });
  }

  return (
    /* Rebuilt 2026-07-30 to the Layout Studio sketch (elitev3-copy.json, screen
       "home"): ONE column in the sketch's order — clock, week, weather,
       notifications, storage, quick links. The sketch is a 390px phone frame,
       so the column is capped rather than spread across a desktop grid, and
       the blocks it does not contain (the 3-up stats row, "Recently added",
       the welcome heading) are deliberately absent. */
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-20 text-white md:pt-24">
      {/* Search box first: the dashboard is the app's landing surface, so
          everything /search can find is one tap away from here. */}
      <div className="mb-3">
        <HomeSearch />
      </div>

      <div className="mb-3">
        <ClockWidget align="center" />
      </div>

      <div className="mb-3">
        <WeekWidget />
      </div>

      <div className="mb-3">
        <WeatherWidget />
      </div>

      <div className="mb-3">
        <NotificationsWidget />
      </div>

      <div className="mb-3">
        <StorageDonut segments={storageSegments} />
      </div>

      {session.role === "admin" && (
        <div className="mb-3 grid grid-cols-1 gap-3">
          <ServerWidget />
          <DockerWidget />
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-white/80">Jump back in</h2>
        <div className="grid grid-cols-2 gap-3">
          {links.map((l) => {
            const Tag = l.hard ? "a" : Link;
            return (
              <Tag
                key={l.label}
                href={l.href}
                className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 px-3 py-5 text-center transition hover:bg-white/10"
              >
                <span className="text-white/80">{l.icon}</span>
                <span className="text-xs font-medium text-white/70">
                  {l.label}
                </span>
              </Tag>
            );
          })}
        </div>
      </section>
    </div>
  );
}
