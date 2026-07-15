import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listAppImportReview,
  decideAppImport,
  ReviewAction,
} from "@/lib/appstore-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function requireAdmin(): Promise<boolean> {
  const session = await getSession();
  return !!session && session.role === "admin";
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ items: listAppImportReview() });
}

const ACTIONS: ReviewAction[] = ["attach", "create-play", "create-new", "discard"];

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const id = Number(body?.id);
  const action = body?.action as ReviewAction;
  if (!id || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const result = await decideAppImport(id, action, {
      appId: body?.appId ? Number(body.appId) : undefined,
      packageId: typeof body?.packageId === "string" ? body.packageId : undefined,
      force: !!body?.force,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message || "Decision failed" },
      { status: 400 }
    );
  }
}
