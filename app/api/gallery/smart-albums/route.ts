import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSmartAlbums, createSmartAlbum } from "@/lib/smart-albums";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ smartAlbums: listSmartAlbums(Number(session.sub)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, criteria } = await request.json().catch(() => ({}));
  const album = createSmartAlbum(Number(session.sub), String(name ?? ""), criteria);
  if (!album) {
    return NextResponse.json(
      { error: "A name and at least one filter are required." },
      { status: 400 }
    );
  }
  return NextResponse.json({ smartAlbum: album });
}
