import ShortsTabs from "@/components/shorts-tabs";

// Shared chrome for the Shorts section: the floating Videos/Explore/Profiles/
// Playlists tab bar over each page. The immersive feed pages render full-bleed
// under it; the grid pages add their own top padding to clear it.
export default async function ShortsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ShortsTabs />
      {children}
    </>
  );
}
