import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TopNav from "@/components/top-nav";
import WebSocketProvider from "@/components/ws-provider";
import PrivacyControls from "@/components/PrivacyControls";

// Shared layout for all authenticated pages: renders the macOS menu bar on top
// and provides the common dark background. Middleware already gates access, but
// we re-check to read the session for the nav.
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <WebSocketProvider>
      <div
        className="relative min-h-screen w-full"
        style={{
          background:
            "radial-gradient(circle at 50% -10%, #20202a 0%, #121212 60%)",
        }}
      >
        <TopNav email={session.email} role={session.role} />
        <div className="pt-14">{children}</div>
        <PrivacyControls />
      </div>
    </WebSocketProvider>
  );
}
