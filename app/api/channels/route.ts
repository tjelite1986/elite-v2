import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listChannels, createChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ channels: listChannels(Number(session.sub)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, description } = await request.json().catch(() => ({}));
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  const channel = createChannel(
    Number(session.sub),
    trimmed,
    typeof description === "string" ? description.trim() : null
  );
  return NextResponse.json({ channel });
}
