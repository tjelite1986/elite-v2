// The Photos section has no chrome of its own anymore: the global bottom nav
// carries the section tabs (Feed/Explore/Videos/Create) and the Menu sheet the
// rest — the old floating top tab bar is gone.
export default function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
