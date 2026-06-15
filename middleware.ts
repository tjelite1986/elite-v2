import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

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

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, static assets and Next internals.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
