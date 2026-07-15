import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Search the Play Store for candidate apps to link a parked APK to. Used by
// the import-review UI when a dropped APK matches nothing in the catalog.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json({ results: [] });
  try {
    const mod: any = await import("google-play-scraper");
    const gp = mod.default ?? mod;
    const hits: any[] = await gp.search({ term: q, num: 6 });
    return NextResponse.json({
      results: (hits || []).map((h) => ({
        packageId: h.appId,
        name: h.title,
        developer: h.developer || null,
        iconUrl: h.icon || null,
        score: h.score || 0,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Play search failed" },
      { status: 400 }
    );
  }
}
