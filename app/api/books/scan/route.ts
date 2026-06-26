import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scanBooks } from "@/lib/books";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await scanBooks(Number(session.sub));
  return NextResponse.json(result);
}
