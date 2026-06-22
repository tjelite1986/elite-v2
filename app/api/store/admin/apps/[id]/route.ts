import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminSetFlag, adminDeleteApp } from "@/lib/store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

// Toggle a curation flag on an app: featured | editors_choice | enabled.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let flag: string | undefined;
  let value: boolean | undefined;
  try {
    const json = await request.json();
    flag = json?.flag;
    value = !!json?.value;
  } catch {
    /* ignore */
  }
  if (flag !== "featured" && flag !== "editors_choice" && flag !== "enabled") {
    return NextResponse.json({ error: "Invalid flag" }, { status: 400 });
  }

  adminSetFlag(Number(params.id), flag, value!);
  return NextResponse.json({ ok: true });
}

// Delete an app from the catalog.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  adminDeleteApp(Number(params.id));
  return NextResponse.json({ ok: true });
}
