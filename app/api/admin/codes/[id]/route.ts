import { NextResponse } from "next/server";
import { db, CodeRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

// Revoke / delete a registration code (e.g. a sent invite). Codes that have
// already been used to create an account can't be deleted — the account
// already exists and removing the record would lose that history.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = getOne<CodeRow>(
    qb.selectFrom("registration_codes").selectAll().where("id", "=", Number(params.id))
  );

  if (!code) {
    return NextResponse.json({ error: "Code not found." }, { status: 404 });
  }
  if (code.used_by) {
    return NextResponse.json(
      { error: "Cannot delete a code that has already been used." },
      { status: 409 }
    );
  }

  db.prepare("DELETE FROM registration_codes WHERE id = ?").run(code.id);
  return NextResponse.json({ ok: true });
}
