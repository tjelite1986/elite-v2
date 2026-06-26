import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserPermissions, PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// List all accounts with their admin-granted permissions, for the admin panel's
// per-user permissions editor. Admin-only.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = db
    .prepare(
      `SELECT u.id AS id, u.email AS email, u.role AS role, p.username AS username
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ORDER BY u.id`
    )
    .all() as { id: number; email: string; role: string; username: string | null }[];

  return NextResponse.json({
    users: users.map((u) => ({ ...u, permissions: getUserPermissions(u.id) })),
    available: PERMISSIONS,
  });
}
