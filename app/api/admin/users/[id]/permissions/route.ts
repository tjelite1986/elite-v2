import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setUserPermissions, getUserPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Replace a user's granted permissions (admin-only). Invalid keys are ignored by
// setUserPermissions. Admins ignore this entirely (they hold all permissions).
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Bad user id" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const perms = Array.isArray(body?.permissions) ? body.permissions.map(String) : [];
  setUserPermissions(userId, perms);
  return NextResponse.json({ ok: true, permissions: getUserPermissions(userId) });
}
