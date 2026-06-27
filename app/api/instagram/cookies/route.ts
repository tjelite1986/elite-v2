import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cookiePoolStatus, cookiesFilePath, listCookiePool } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const toHost = (p: string) =>
  p.replace(/^\/instagram-store\//, "/mnt/4tb/elitev2/instagram/");

// Cookie status for the Instagram manage page (admin only). Reports the whole
// cookie pool (one entry per IG account: alive / cooling / username) plus the
// host paths so the admin knows where to drop each Netscape cookies.txt.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pool = listCookiePool();
  const enabled = pool.length > 0;
  const status = enabled ? cookiePoolStatus() : [];
  const byId = new Map(status.map((s) => [s.id, s]));
  return NextResponse.json({
    // Back-compat top-level fields (the editor reads enabled/alive).
    enabled,
    alive: status.some((s) => s.alive),
    path: cookiesFilePath(),
    hostPath: toHost(cookiesFilePath()),
    count: pool.length,
    cookies: pool.map((m) => {
      const s = byId.get(m.id);
      return {
        id: m.id,
        hostPath: toHost(m.path),
        alive: s?.alive ?? false,
        cooling: s?.cooling ?? false,
        until: s?.cooling_until ?? null,
        username: s?.username ?? "",
      };
    }),
  });
}
