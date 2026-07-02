import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getGalleryDupeGroups, getGalleryDupeState } from "@/lib/gallery-duplicates";

export const dynamic = "force-dynamic";

// Latest duplicate-scan results + scan progress for the gallery library (admin
// only).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "gallery_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    state: getGalleryDupeState(),
    groups: getGalleryDupeGroups(),
  });
}
