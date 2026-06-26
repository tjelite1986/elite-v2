import { NextResponse } from "next/server";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { tagsForItem, setItemTags } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

// Confirm the item is owned by the caller; tags are private to the owner.
function ownsItem(userId: number, itemId: number): boolean {
  return Boolean(
    getOne(
      qb
        .selectFrom("gallery_items")
        .select("id")
        .where("id", "=", itemId)
        .where("user_id", "=", userId)
    )
  );
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ownsItem(Number(session.sub), Number(params.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ tags: tagsForItem(Number(params.id)) });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  setItemTags(Number(session.sub), Number(params.id), tags);
  return NextResponse.json({ tags: tagsForItem(Number(params.id)) });
}
