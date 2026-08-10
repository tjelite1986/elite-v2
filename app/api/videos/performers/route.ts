import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import {
  createPerformer,
  createPerformerFromTpdb,
  getPerformer,
  listPerformers,
} from "@/lib/video-performers";
import { parseTpdbRef } from "@/lib/tpdb";

export const dynamic = "force-dynamic";
// Creating from an identifier fetches the record, its portrait and its photos.
export const maxDuration = 120;

// Performers are an 18+ library concept, so the gate applies to the list too.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ performers: listPerformers() });
}

// Create a profile by hand, for someone the automatic sources do not know.
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    // { tpdbId } imports an existing record — an id, a "performers/<id>"
    // reference or the profile URL all address the same thing.
    if (typeof body?.tpdbId === "string" && body.tpdbId.trim()) {
      const ref = parseTpdbRef(body.tpdbId);
      if (!ref || (ref.type && ref.type !== "performer")) {
        return NextResponse.json(
          { error: "That is not a performer id or link." },
          { status: 400 }
        );
      }
      const slug = await createPerformerFromTpdb(ref.id);
      if (!slug) {
        return NextResponse.json(
          { error: "ThePornDB has no performer with that id." },
          { status: 404 }
        );
      }
      return NextResponse.json({ slug, performer: getPerformer(slug) });
    }
    const slug = createPerformer(body ?? {});
    return NextResponse.json({ slug, performer: getPerformer(slug) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create performer." },
      { status: 400 }
    );
  }
}
