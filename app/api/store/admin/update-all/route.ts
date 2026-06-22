import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateAllDownloadable } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

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
  const result = await updateAllDownloadable();
  return NextResponse.json({ ok: true, ...result });
}
