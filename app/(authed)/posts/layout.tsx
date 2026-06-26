import PostsTabs from "@/components/posts-tabs";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// Shared chrome for the Photos section: the floating Feed/Explore/Create/Profile
// tab bar over each page (mirrors the Shorts layout).
export default async function PostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const canSettings = hasPermission(session, "posts_settings");
  return (
    <>
      <PostsTabs canSettings={canSettings} />
      {children}
    </>
  );
}
