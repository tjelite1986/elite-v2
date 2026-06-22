import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { approveSigner } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";

// Deliberate admin override after a signer_mismatch (e.g. a legitimate key
// rotation): clear the pin + review flag so the next "Update now" re-pins.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  approveSigner(Number(params.id));
  return NextResponse.json({ ok: true });
}
