import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { canAccessChannel, getShort } from "@/lib/shorts";
import { posterPathFor } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

// Serve a short's poster (JPEG). Same gate enforcement as the video route.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const short = getShort(Number(params.id));
  if (!short || !short.poster_key) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = posterPathFor(short.channel, short.poster_key);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
