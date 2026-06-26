import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLinkPreview } from "@/lib/link-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ preview: null });
  const preview = await getLinkPreview(url);
  return NextResponse.json({ preview });
}
