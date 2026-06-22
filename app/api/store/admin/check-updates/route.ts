import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkAll } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Admin session OR the shared-secret header (so the host timer can call it).
async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.APP_UPDATE_SECRET;
  if (secret && request.headers.get("x-app-update-secret") === secret) return true;
  const session = await getSession();
  return !!session && session.role === "admin";
}

export async function POST(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let source: string | undefined;
  try {
    source = (await request.json())?.source;
  } catch {
    /* ignore */
  }
  const result = await checkAll(source);
  return NextResponse.json({ ok: true, ...result });
}
