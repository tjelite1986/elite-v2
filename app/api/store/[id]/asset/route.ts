import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getAppRow, getScreenshotKey } from "@/lib/store";
import { contentTypeForImage } from "@/lib/appstore-archive";
import { resolveAppFile } from "@/lib/appstore-storage";

export const dynamic = "force-dynamic";

// Serve an app's icon / banner / screenshot from the on-disk archive. Auth +
// the 18+ gate are enforced here too — never trust the page to have gated.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app) return new NextResponse("Not found", { status: 404 });
  // Adult apps require the 18+ gate for their imagery — except admins, who
  // manage every app (including adult ones) and need to see icons in /manage.
  if (
    app.requires_pin &&
    session.role !== "admin" &&
    !(await has18Access())
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "icon";

  let key: string | null = null;
  if (type === "icon") key = app.icon_key;
  else if (type === "banner") key = app.banner_key;
  else if (type === "screenshot") {
    const i = Number(url.searchParams.get("i") || "0");
    key = getScreenshotKey(app.id, isNaN(i) ? 0 : i);
  }
  if (!key) return new NextResponse("Not found", { status: 404 });

  const abs = resolveAppFile(app.source, key);
  if (!abs) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(fs.readFileSync(abs), {
    headers: {
      "Content-Type": contentTypeForImage(key),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
