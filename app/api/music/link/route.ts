import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import {
  MusicAccountError,
  linkMusicAccount,
  unlinkMusicAccount,
} from "@/lib/navidrome-accounts";

export const dynamic = "force-dynamic";

// Manual fallback for the auto-provisioning in lib/navidrome-accounts.ts: link
// an existing Navidrome account by username + password. The password is used
// once to mint the Subsonic salt/token pair and is not stored.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    password?: string;
    library?: string;
  } | null;

  const username = (body?.username || "").trim();
  const password = body?.password || "";
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Username and password are required" },
      { status: 400 }
    );
  }

  try {
    await linkMusicAccount(
      Number(session.sub),
      parseLibrary(body?.library),
      username,
      password
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MusicAccountError) {
      return NextResponse.json(
        { ok: false, error: e.message, reason: e.reason },
        { status: e.reason === "login_failed" ? 401 : 503 }
      );
    }
    throw e;
  }
}

// Forget the stored credentials — the next /music visit re-provisions.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  unlinkMusicAccount(
    Number(session.sub),
    parseLibrary(new URL(request.url).searchParams.get("library"))
  );
  return NextResponse.json({ ok: true });
}
