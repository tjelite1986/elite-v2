// The App Store section has no chrome of its own anymore: the global bottom
// nav carries the section tabs (Discover/Search/Installed/Saved) and the Menu
// sheet the admin overflow (Manage) — the old floating top tab bar is gone.
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
