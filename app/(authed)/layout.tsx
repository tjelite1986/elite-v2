import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { getAppearance, bgCss } from "@/lib/appearance";
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

  // Own handle for the top-nav "Profile" entry — it links to the unified
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
          )}}`,
        }}
      />
      <div
        className="relative min-h-[100dvh] w-full"
        style={{ background: "var(--app-bg)" }}
      >
        <TopNav
          email={session.email}
          role={session.role}
          username={username}
          imp={session.imp ?? null}
          isRealAdmin={session.role === "admin" && !session.imp}
        />
        <div className="pt-14">{children}</div>
        <PrivacyControls />
      </div>
    </WebSocketProvider>
  );
}
