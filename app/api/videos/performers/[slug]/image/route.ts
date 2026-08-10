import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import {
  addPerformerImage,
  getPerformer,
  performerImage,
  removePerformerImage,
  savePerformerPortrait,
} from "@/lib/video-performers";
import { isUnderPosters, posterFilePath } from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

async function requireAdmin(
  slug: string
): Promise<{ error: string; status: 403 | 404 } | null> {
  const session = await getSession();
  if (session?.role !== "admin") return { error: "Forbidden", status: 403 };
  if (!(await canAccessVideoChannel("adults"))) {
    return { error: "Forbidden", status: 403 };
  }
  if (!getPerformer(slug)) return { error: "Not found", status: 404 };
  return null;
}

// ?i=<n> serves the n-th gallery photo; without it, the portrait.
export async function GET(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await canAccessVideoChannel("adults"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const raw = new URL(request.url).searchParams.get("i");
  const key =
    raw !== null && Number.isFinite(Number(raw))
      ? performerImage(slug, Number(raw))
      : getPerformer(slug)?.image_key;
  if (!key) return new NextResponse("Not found", { status: 404 });

  const filePath = posterFilePath(key);
  if (!isUnderPosters(filePath) || !fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(filePath)), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

// Upload a picture: the portrait by default, or ?slot=gallery to append one to
// the photo strip. Everything is re-encoded to JPEG by sharp, so whatever the
// file claims to be, what lands on disk is an image we produced.
export async function POST(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const guard = await requireAdmin(slug);
  if (guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That image is too large." }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const gallery = new URL(request.url).searchParams.get("slot") === "gallery";

  if (gallery) {
    const idx = await addPerformerImage(slug, buffer);
    if (idx === null) {
      return NextResponse.json(
        { error: "That file is not a readable image." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, index: idx, performer: getPerformer(slug) });
  }

  const key = await savePerformerPortrait(slug, buffer);
  if (!key) {
    return NextResponse.json(
      { error: "That file is not a readable image." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, performer: getPerformer(slug) });
}

// Remove one photo from the strip (?i=<n>).
export async function DELETE(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const guard = await requireAdmin(slug);
  if (guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const raw = new URL(request.url).searchParams.get("i");
  if (raw === null || !Number.isFinite(Number(raw))) {
    return NextResponse.json({ error: "Which photo?" }, { status: 400 });
  }
  removePerformerImage(slug, Number(raw));
  return NextResponse.json({ ok: true, performer: getPerformer(slug) });
}
