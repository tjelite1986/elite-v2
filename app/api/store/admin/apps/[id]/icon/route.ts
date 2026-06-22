import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { getAppRow, adminSetIconKey } from "@/lib/store";
import { STORE_DIR, storeKey, ensureDir } from "@/lib/appstore-storage";

export const dynamic = "force-dynamic";

// Upload a custom icon for an app. Stored in STORE_DIR and addressed via the
// "store:" key prefix so it resolves regardless of the app's primary source.
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const app = getAppRow(Number(params.id));
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    file = form.get("file") as File | null;
  } catch {
    /* ignore */
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const rel = `${app.slug}/assets/custom-icon.${ext}`;
  const abs = path.join(STORE_DIR, rel);
  try {
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }

  adminSetIconKey(app.id, storeKey(rel));
  return NextResponse.json({ ok: true });
}
