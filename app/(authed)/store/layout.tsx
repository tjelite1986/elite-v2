import { getSession } from "@/lib/auth";
import StoreTabs from "@/components/store-tabs";

// Shared chrome for the App Store section: the floating tab bar over each page.
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <>
      <StoreTabs isAdmin={session?.role === "admin"} />
      {children}
    </>
  );
}
