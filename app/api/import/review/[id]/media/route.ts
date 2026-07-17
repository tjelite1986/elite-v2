import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { IMPORT_ROOT } from "@/lib/storage-roots";
import type { ImportReviewRow } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

// Stream a parked duplicate for the side-by-side comparison. Owner or admin.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let q = qb
    .selectFrom("import_review")
    .selectAll()
    .where("id", "=", Number(id));
  if (session.role !== "admin") {
    q = q.where("user_id", "=", Number(session.sub));
  }
  const row = getOne<ImportReviewRow>(q);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = fs.readFileSync(path.join(IMPORT_ROOT, row.file_rel));
    const ext = path.extname(row.file_rel).toLowerCase();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
}
