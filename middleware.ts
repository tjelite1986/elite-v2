import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Public paths that never require a session.
const PUBLIC_PATHS = ["/login", "/register", "/request-invite", "/share"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // NOTE: we deliberately do NOT bounce "authenticated" users away from /login
  // here. Middleware runs on the edge and can't check session revocation (no DB
  // access), so a remotely-revoked-but-still-signed token would look valid. If
  // we redirected it off /login, the (authed) layout's revocation-aware
  // getSession would redirect it back, creating a loop. Letting /login render is
  // harmless — re-logging in simply mints a fresh session.

  // Unauthenticated users are pushed to /login for protected pages.
  if (!session && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Gate the admin area on role.
  if (pathname.startsWith("/admin") && session?.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // The 18+ section is per-user gated in the node layout + every 18+ API route
  // (has18Access is now per-user and can't be evaluated on the edge without DB),
  // so there's no edge redirect here. Adult content is open by default; a user
  // who set a personal PIN sees the unlock prompt from the layout.

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and static assets
  // (icons, the web manifest, the service worker) — those must stay public so
  // the PWA can install and the SW can register before/without a session.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webmanifest|js|mjs|map|css|woff2?|txt|xml)$).*)",
  ],
};
