import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { getAppearance, bgCss } from "@/lib/appearance";
import BottomNav from "@/components/bottom-nav";
import InstallBanner from "@/components/install-banner";
import { ActAsBanner } from "@/components/ui/act-as-controls";
import WebSocketProvider from "@/components/ws-provider";
import PrivacyControls from "@/components/PrivacyControls";

// Shared layout for all authenticated pages: renders the global bottom nav
// and provides the common dark background. Middleware already gates access, but
// we re-check to read the session for the nav.
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Own handle for the nav menu's profile entry — it links to the unified
  // /people/<username> profile (same page anyone else sees), so there's a single
  // profile surface. ensureUserProfile guarantees the row exists.
  const { username } = ensureUserProfile(Number(session.sub), session.email);

  // Per-user appearance: accent colour + background theme, applied as CSS vars
  // server-side (no flash). Live changes in Settings override these on :root.
  const appearance = getAppearance(Number(session.sub));

  return (
    <WebSocketProvider>
      {/* Safe interpolation: accent is validated to a 6-digit hex by
          isValidAccent, and bgCss only returns values from the fixed BG_THEMES
          map — never free user text — so no untrusted content reaches the CSS. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `:root{--accent:${appearance.accent};--app-bg:${bgCss(
            appearance.bgTheme
          )};--fab-offset:3.5rem}`,
        }}
      />
      <div
        className="relative min-h-[100dvh] w-full"
        style={{ background: "var(--app-bg)" }}
      >
        <BottomNav
          username={username}
          email={session.email}
          canActAs={session.role === "admin" || !!session.imp}
          isAdmin={session.role === "admin"}
        >
          {children}
        </BottomNav>
        <ActAsBanner
          imp={session.imp ?? null}
          actingAsEmail={session.email}
        />
        <InstallBanner />
        <PrivacyControls />
      </div>
    </WebSocketProvider>
  );
}
