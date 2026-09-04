import { redirect } from "next/navigation";
import { musicConfigured } from "@/lib/subsonic";

// /music is a player over Navidrome and has no other backend. When no library
// is configured every page below here would render an empty shell, so the whole
// section is closed off at the route level: the nav entry is already hidden (see
// the authed layout), and this catches anyone arriving by URL, bookmark or an
// old share link.
//
// This gates the pages only. The /api/music/* routes keep their own guards —
// they already return an error when a library is missing, and each one is still
// reachable by a client that has a stale page open.
export default function MusicSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!musicConfigured()) redirect("/");
  return <>{children}</>;
}
