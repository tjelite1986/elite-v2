// Shared entry point for every /api/music route: session -> library -> creds.
//
// Routes never take a Navidrome URL or a username from the request; the only
// client-supplied part is the library id, which is validated against the fixed
// set in lib/subsonic.ts. Failures come back as a JSON body with a `reason` the
// music UI can act on (offer manual linking, hide a library, tell the admin the
// server is down) rather than an opaque 500.

import { NextResponse } from "next/server";
import { getSession } from "./auth";
import {
  MusicLibrary,
  SubsonicCreds,
  SubsonicError,
  parseLibrary,
} from "./subsonic";
import { MusicAccountError, getMusicCreds } from "./navidrome-accounts";

export interface MusicContext {
  userId: number;
  library: MusicLibrary;
  creds: SubsonicCreds;
}

type Resolved =
  | { ok: true; ctx: MusicContext }
  | { ok: false; response: NextResponse };

/**
 * Resolve the caller's Subsonic credentials for the requested library, creating
 * their Navidrome account on first use.
 */
export async function resolveMusic(request: Request): Promise<Resolved> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  const userId = Number(session.sub);
  if (!Number.isInteger(userId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const library = parseLibrary(
    new URL(request.url).searchParams.get("library")
  );

  try {
    const creds = await getMusicCreds(userId, library);
    return { ok: true, ctx: { userId, library, creds } };
  } catch (e) {
    if (e instanceof MusicAccountError) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: e.message, reason: e.reason },
          // 503, not 500: nothing is wrong with the request — the music backend
          // is unconfigured or unreachable, and the UI shows a setup notice.
          { status: e.reason === "not_configured" ? 404 : 503 }
        ),
      };
    }
    throw e;
  }
}

/** Uniform error body for a failed Subsonic call inside a route handler. */
export function musicError(e: unknown): NextResponse {
  if (e instanceof SubsonicError) {
    // Subsonic code 70 = "the requested data was not found".
    const status = e.code === 70 ? 404 : e.code === 50 ? 403 : 502;
    return NextResponse.json(
      { ok: false, error: e.message, code: e.code },
      { status }
    );
  }
  if (e instanceof MusicAccountError) {
    return NextResponse.json(
      { ok: false, error: e.message, reason: e.reason },
      { status: 503 }
    );
  }
  console.error("[music] unexpected error", e);
  return NextResponse.json(
    { ok: false, error: "Music request failed" },
    { status: 500 }
  );
}
