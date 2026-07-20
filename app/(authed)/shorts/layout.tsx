// The Shorts section has no chrome of its own anymore: the global bottom nav
// carries the section tabs (Videos/Explore/Profiles/Mine) and the Menu sheet
// the overflow (Playlists/Grab) — the old floating top tab bar is gone.
export default async function ShortsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
