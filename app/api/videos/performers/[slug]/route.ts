import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import {
  deletePerformer,
  enrichPerformer,
  getPerformer,
  updatePerformer,
} from "@/lib/video-performers";
import { parseTpdbRef } from "@/lib/tpdb";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  _request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const performer = getPerformer(slug);
  if (!performer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ performer });
}

// Re-fetch the profile from ThePornDB (the Refresh button). An optional
// { tpdbId } points it at one exact record instead of searching by name.
export async function POST(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.tpdbId === "string" ? body.tpdbId.trim() : "";
  let tpdbId: string | undefined;
  if (raw) {
    const ref = parseTpdbRef(raw);
    if (!ref || (ref.type && ref.type !== "performer")) {
      return NextResponse.json(
        { error: "That is not a performer id or link." },
        { status: 400 }
      );
    }
    tpdbId = ref.id;
  }
  const ok = await enrichPerformer(slug, tpdbId);
  return NextResponse.json({
    ok,
    performer: getPerformer(slug),
    message: ok
      ? "Profile updated."
      : tpdbId
        ? "No performer with that id."
        : "No matching profile found.",
  });
}

// Edit the profile's fields. Any profile can be edited — a wrong value from a
// sidecar is worth correcting too — but a later Refresh overwrites what the
// database has an opinion about.
export async function PATCH(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!getPerformer(slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    updatePerformer(slug, body ?? {});
    return NextResponse.json({ performer: getPerformer(slug) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save profile." },
      { status: 400 }
    );
  }
}

// Only hand-made profiles are deletable: a derived one would simply come back
// on the next metadata pass, so removing it would look like the app ignoring
// the request.
export async function DELETE(
  _request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const performer = getPerformer(slug);
  if (!performer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!performer.manual) {
    return NextResponse.json(
      {
        error:
          "This profile comes from the film's metadata and would return on the next scan.",
      },
      { status: 400 }
    );
  }
  deletePerformer(slug);
  return NextResponse.json({ ok: true });
}
