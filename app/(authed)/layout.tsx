import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { getAppearance, bgCss } from "@/lib/appearance";
import BottomNav from "@/components/bottom-nav";
import InstallBanner from "@/components/install-banner";
import { ActAsBanner } from "@/components/ui/act-as-controls";
import WebSocketProvider from "@/components/ws-provider";
import PrivacyControls from "@/components/PrivacyControls";
import MusicPlayerProvider from "@/components/music/player-provider";
import MiniPlayer from "@/components/music/mini-player";
import { showsAppstore } from "@/lib/permissions";

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
  const { username, display_name } = ensureUserProfile(
    Number(session.sub),
    session.email
  );

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
          // --player-h is set by MusicPlayerProvider (0 when nothing is loaded,
          // the mini player's height when it is), so every control anchored to
          // --fab-offset lifts above the player strip on its own.
          __html: `:root{--accent:${appearance.accent};--app-bg:${bgCss(
            appearance.bgTheme
          )};--player-h:0px;--fab-offset:calc(3.5rem + var(--player-h, 0px))}`,
        }}
      />
      <div
        className="relative min-h-[100dvh] w-full"
        style={{ background: "var(--app-bg)" }}
      >
        {/* The music player wraps the router outlet so its single <audio>
            element outlives every client-side navigation. */}
        <MusicPlayerProvider>
          <BottomNav
            username={username}
            displayName={display_name}
            email={session.email}
            canActAs={session.role === "admin" || !!session.imp}
            isAdmin={session.role === "admin"}
            showAppstore={showsAppstore(session)}
            // The standalone shorts app, when one is deployed alongside this
            // one. Read here rather than in the menu because that is a client
            // component: a NEXT_PUBLIC_ variable would bake the address into
            // the image at build time instead of reading it at run time.
            tikshortisUrl={process.env.TIKSHORTIS_URL || null}
          >
            {children}
          </BottomNav>
          <MiniPlayer />
        </MusicPlayerProvider>
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
