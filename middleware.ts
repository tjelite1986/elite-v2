import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { GATE_COOKIE, verifyGateToken } from "@/lib/shorts-gate";

// Public paths that never require a session.
const PUBLIC_PATHS = ["/login", "/register", "/request-invite"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Already authenticated users skip the auth pages.
  if (session && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

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

  // Gate the separate 18+ shorts section behind a valid PIN-unlock cookie. The
  // /shorts18 root is allowed through so its layout can render the PIN prompt;
  // deeper paths (profiles, settings, watch views) require an unlocked gate.
  if (pathname.startsWith("/shorts18/") || pathname === "/shorts18") {
    const gateOk = await verifyGateToken(request.cookies.get(GATE_COOKIE)?.value);
    if (!gateOk && pathname !== "/shorts18") {
      return NextResponse.redirect(new URL("/shorts18", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, static assets and Next internals.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
