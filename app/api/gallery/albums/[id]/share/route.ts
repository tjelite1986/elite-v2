import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getShareToken,
  createShareToken,
  revokeShare,
} from "@/lib/album-share";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    token: getShareToken(Number(params.id), Number(session.sub)),
  });
}

// Create (or return the existing) public share link for an album the user owns.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = createShareToken(Number(params.id), Number(session.sub));
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ token });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  revokeShare(Number(params.id), Number(session.sub));
  return NextResponse.json({ ok: true });
}
