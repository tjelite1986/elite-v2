import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  MUSIC_LIBRARIES,
  MusicLibrary,
  libraryBaseUrl,
  libraryReachable,
} from "@/lib/subsonic";
import { hasMusicAccount } from "@/lib/navidrome-accounts";

export const dynamic = "force-dynamic";

// Which music libraries this user can switch between. A library is offered only
// when it is both configured and answering: the kids instance is normally
// stopped, and the switcher should simply not show it rather than hand out a
// tab that errors on every tap.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const configured = MUSIC_LIBRARIES.filter((l) => libraryBaseUrl(l.id));
  const libraries = await Promise.all(
    configured.map(async (l) => ({
      id: l.id as MusicLibrary,
      label: l.label,
      online: await libraryReachable(l.id),
      linked: hasMusicAccount(userId, l.id),
    }))
  );

  return NextResponse.json({
    ok: true,
    libraries: libraries.filter((l) => l.online),
    // Kept separate so an admin can tell "not configured" from "container down".
    offline: libraries.filter((l) => !l.online).map((l) => l.id),
  });
}
