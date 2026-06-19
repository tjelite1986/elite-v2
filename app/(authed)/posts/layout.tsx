import PostsTabs from "@/components/posts-tabs";

// Shared chrome for the Photos section: the floating Feed/Explore/Create/Profile
// tab bar over each page (mirrors the Shorts layout).
export default function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PostsTabs />
      {children}
    </>
  );
}
