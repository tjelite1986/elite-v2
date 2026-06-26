import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ trips: computeTrips(Number(session.sub)) });
}
