import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, CodeRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { isCodeExpired } from "@/lib/codes";
import { getUserByEmail } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { ensureUserProfile } from "@/lib/profiles";
import { ensureUserHome } from "@/lib/shorts-storage";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const { email, password, code } = await request
    .json()
    .catch(() => ({}));

  if (!email || !password || !code) {
    return NextResponse.json(
      { error: "Email, password and registration code are required." },
      { status: 400 }
    );
  }
  if (!validateEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }
  if (String(password).length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  if (getUserByEmail(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const normalizedCode = String(code).trim().toUpperCase();
  const codeRow = getOne<CodeRow>(
    qb.selectFrom("registration_codes").selectAll().where("code", "=", normalizedCode)
  );

  if (!codeRow) {
    return NextResponse.json(
      { error: "Invalid registration code." },
      { status: 403 }
    );
  }
  if (codeRow.used_by) {
    return NextResponse.json(
      { error: "This registration code has already been used." },
      { status: 403 }
    );
  }
  if (isCodeExpired(codeRow.expires_at)) {
    return NextResponse.json(
      { error: "This registration code has expired." },
      { status: 403 }
    );
  }

  // Create the user and consume the code atomically.
  const createUserAndConsume = db.transaction(() => {
    const result = db
      .prepare(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')"
      )
      .run(String(email).toLowerCase(), hashPassword(password));
    const userId = Number(result.lastInsertRowid);
    db.prepare(
      "UPDATE registration_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?"
    ).run(userId, codeRow.id);
    return userId;
  });

  const userId = createUserAndConsume();

  // Provision the new account immediately: give it a public profile (username)
  // and pre-create its per-user home folder + subfolders on disk, instead of
  // creating them lazily on first upload. Best-effort — a filesystem hiccup must
  // not fail an otherwise-successful registration.
  try {
    const profile = ensureUserProfile(userId, String(email).toLowerCase());
    ensureUserHome(userId, profile.username);
  } catch (err) {
    console.error("Failed to provision home for new user", userId, err);
  }

  const token = await createSessionToken({
    sub: String(userId),
    email: String(email).toLowerCase(),
    role: "user",
  });

  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  return NextResponse.json({ ok: true });
}
