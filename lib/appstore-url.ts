/**
 * Where the App Store answers.
 *
 * Its own host, and a whole site of its own — this app only draws two links to
 * it (the menu row and the dashboard tile), and both have to be real
 * navigations off this origin rather than routes of ours. It briefly lived at
 * `/store` on this host instead, between 2026-08-26 and 2026-08-31; the two
 * call sites are the reason that address is stated once, here.
 *
 * The login is shared regardless of which host it is on: elite-v2's session
 * cookie is scoped to `.mecloud.win`, and the store resolves it against
 * `POST /api/auth/verify`.
 *
 * `NEXT_PUBLIC_` because one of the two call sites is a client component. Set
 * it to move the store; unset, this machine's address stands.
 */
export const APPSTORE_URL =
  process.env.NEXT_PUBLIC_APPSTORE_URL?.trim() || "https://astore.mecloud.win";
