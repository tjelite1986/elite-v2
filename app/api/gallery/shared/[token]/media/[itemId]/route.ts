import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { sharedItemFile } from "@/lib/album-share";
import {
  originalPathFor,
  thumbPathFor,
  previewPathFor,
} from "@/lib/gallery-storage";
import { imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Public media for an item that belongs to a shared album. No session — access
// is scoped strictly to items reachable through the (unguessable) token.
export async function GET(
  request: Request,
  { params }: { params: { token: string; itemId: string } }
) {
  const file = sharedItemFile(params.token, Number(params.itemId));
  if (!file) return new NextResponse("Not found", { status: 404 });

  const variant = new URL(request.url).searchParams.get("variant") || "thumb";

  if (variant !== "original") {
    const path =
      variant === "preview"
        ? previewPathFor(file.owner_id, file.storage_key)
        : thumbPathFor(file.owner_id, file.storage_key);
    if (!fs.existsSync(path)) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(
      Readable.toWeb(fs.createReadStream(path)) as unknown as ReadableStream,
      {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(fs.statSync(path).size),
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }

  const path = originalPathFor(file.owner_id, file.storage_key);
  if (!fs.existsSync(path)) return new NextResponse("Not found", { status: 404 });
  // This route is public (no auth). Never serve a content-type the browser would
  // execute as a document/script on our origin — clamp to image/video, else hand
  // it back as an opaque download. (X-Content-Type-Options: nosniff in addition.)
  const detected = imageMimeFor(file.storage_key);
  const safe = /^(image|video)\//.test(detected);
  return new NextResponse(
    Readable.toWeb(fs.createReadStream(path)) as unknown as ReadableStream,
    {
      headers: {
        "Content-Type": safe ? detected : "application/octet-stream",
        "Content-Length": String(fs.statSync(path).size),
        ...(safe ? {} : { "Content-Disposition": "attachment" }),
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
