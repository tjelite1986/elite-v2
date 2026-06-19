import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  GATE_COOKIE,
  createGateToken,
  gateCookieOptions,
  getPin,
} from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// Verify the 18+ PIN and, on success, set the signed gate cookie. Generic error
// messages avoid revealing whether a PIN is configured.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pin = getPin();
  if (!pin) {
    return NextResponse.json(
      { error: "Adult channel is not configured" },
      { status: 403 }
    );
  }

  let submitted = "";
  try {
    const body = await request.json();
    submitted = typeof body?.pin === "string" ? body.pin : "";
  } catch {
    submitted = "";
  }

  if (submitted !== pin) {
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  const token = await createGateToken(session.sub);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, gateCookieOptions);
  return res;
}
