import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ingestMedia } from "@/lib/gallery-ingest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const lastModified = form.getAll("lastModified").map((v) => Number(v));

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  let created = 0;
  const skipped: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const id = await ingestMedia(
        userId,
        file.name,
        file.type,
        buffer,
        lastModified[i] ?? null
      );
      if (id) created++;
      else skipped.push(file.name);
    } catch (err) {
      console.error(`[gallery] failed to ingest ${file.name}:`, err);
      skipped.push(file.name);
    }
  }

  return NextResponse.json({ ok: true, created, skipped });
}
