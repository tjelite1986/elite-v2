import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cookiesAlive, cookiesFilePath, hasCookies } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Cookie-file status for the Instagram manage page (admin only). Reports both
// whether the file exists and whether the session is still valid (a live call),
// plus the host path so the admin knows where to drop the Netscape cookies.txt.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const enabled = hasCookies();
  return NextResponse.json({
    enabled,
    alive: enabled ? cookiesAlive() : false,
    path: cookiesFilePath(),
    hostPath: cookiesFilePath().replace(/^\/instagram-store\//, "/mnt/4tb/elitev2/instagram/"),
  });
}
