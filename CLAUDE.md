# elite-v2 — Claude Code Instructions

## Working rules (every session, local or cloud)

- **Language:** everything written to a file is English: code comments, UI
  strings, API error messages, log output, README, JSON descriptions, commit
  messages. Chat with the owner in Swedish. No emojis unless asked.
- **`docs/` is local-only.** It is a scratch area between the owner and Claude,
  gitignored on purpose. Never commit it and never `git add -f` it. A cloud
  session will not see it; ask the owner to paste what you need.
- **No secrets in git:** `.env`, `.env.*`, dated backups like `.env.bak-*`,
  keys and tokens. Read `git status` before every commit.
- **Target platform:** the owner self-hosts on a Raspberry Pi (linux/arm64,
  Node 20) and an x86 Linux box, as Docker images behind Traefik. Code must
  build and run on linux/arm64 with Node 20. Check that any new native
  dependency ships arm64 builds.
- **Cloud sessions cannot reach production:** no host, no live database, no
  `.env`, no container logs. Deliver work as a branch and a PR whose
  description says how to verify it live. Deploy and live verification are
  done by the owner on the host. Do not claim something works in production.
- **Data safety:** never blanket-`DELETE` or `rm` a database or data directory
  to clean up after a test; remove only what the test created.
- **Keep diffs about the change:** do not reformat code you are not otherwise
  touching. Run `prettier --check` before `prettier --write` on an older file.
- **Archive, don't delete:** don't delete branches; tag them `archive/<name>`
  first.

## Lessons learned

Things that broke before or decisions not to undo. Each rule has its reason.

### Data layer (SQLite, Kysely)
- **Kysely builds, better-sqlite3 executes.** `qb` in `lib/kysely.ts` only compiles; never call `.execute()`. Run queries with `getOne`/`getAll`/`runSync`. Why: the whole data layer is synchronous, and `.execute()` would push `await` through every caller.
- **Reads go through Kysely; INSERT/UPDATE/DELETE and transactions stay raw `db.prepare`.** Raw reads are allowed only where Kysely can't help: FTS `MATCH`, `json_each`, and `lib/db.ts` migrate/seed. Add new tables to the `DB` interface by reusing the `*Row` types from `lib/db.ts`. Do not add kysely-codegen, because it would drop the literal unions.
- **Anything imported at runtime belongs in `dependencies`, not `devDependencies`.** The runtime image installs with `npm ci --omit=dev`; `kysely` as a devDep once crashed production.
- **Schema changes go in `migrate()` as `CREATE ... IF NOT EXISTS` plus an ALTER guarded by `PRAGMA table_info`.** Data changes go in a numbered `user_version` step. Why: migrate runs on every process start, and a data condition can't be guarded by looking at the data. A revoked permission looks the same as a missing one, and a backfill keyed on the column's own value runs again on every boot and overwrites user choices.
- **Set `busy_timeout` as the first pragma, before `journal_mode = WAL`, in every `new Database(` (scripts and `lib/jobs-runtime.mjs` included).** Why: `next build` collects page data in parallel workers that all open and migrate the same fresh file. The wrong order made Docker builds fail with "database is locked".
- **Don't open the DB or do other I/O at module top level in new modules that routes import.** Import `db` from `lib/db.ts`, which serializes startup under `BEGIN IMMEDIATE` and retries.
- **Use `.immediate()` on any transaction that reads before it writes.** Why: a deferred transaction's lock upgrade returns SQLITE_BUSY at once and never consults `busy_timeout`.
- **Unlink files after the commit, never inside the transaction.** An orphan file is repairable, and the maintenance sweep finds it. A row pointing at a deleted file is not repairable.
- **The DB file has several writers.** Next handlers, `server.mjs` (WebSocket presence), `lib/jobs-runtime.mjs` (its own connection) and child scripts all write to it. Keep write transactions short and never hold one across file or network I/O.
- **FTS5 external-content tables: `count(*)` reads the content table, so it can't detect an empty or desynced index.** Only `INSERT INTO x_fts(x_fts, rank) VALUES('integrity-check', 0)` can (migrate runs it). A desynced index makes every UPDATE/DELETE on the source table throw "database disk image is malformed". Tables with a TEXT primary key (books) are not safe for content-table FTS.
- **SQLite `datetime('now')` is UTC.** Do date math in SQLite, the way `lib/codes.ts` does, rather than mixing it with JS local time.

### Retired sections: keep them closed
- **Shorts, posts and people now live in separate apps.** `/shorts`, `/shorts18`, `/posts` and `/people` are catch-all redirects to URLs taken from env, and an unset URL sends the visitor home. The shorts tables are dropped by migration 2. Don't bring the code back, and never hard-code another app's hostname: read it from env.
- **Retiring a section or enum value means closing every write path in the same change.** Default the parameter to the value that survives, make write routes refuse the retired one, redirect its pages, and stop creating its drop folders. Grep the literal across `lib app components scripts`, including writers that derive the value from another column (a ternary). Hide the control AND refuse it server-side. Why: a "deleted" channel refilled itself twice, once through an open default and once through an internal move function.
- **Moving or removing a module:** grep for the env constant (`*_ROOT`), not the path, because storage roots collect other users (the avatars lived in the posts root). Check that every `"/api/..."` string in client code has a matching `app/api/**/route.ts`, since nothing verifies it and a 404 on an `<img>` is silent. Grep the table names a moved module queries.
- **The adult-gate JWT scope in `lib/adult-gate.ts` is still `"shorts18"`.** Don't rename it: that would invalidate every gate cookie in circulation.

### Auth and security
- **`middleware.ts` runs on the edge and has no DB, so it can't see session revocation.** It deliberately does not bounce logged-in users away from `/login`, because doing so caused a redirect loop for revoked tokens. Revocation is enforced in `getSession()` (`lib/auth.ts`).
- **The middleware matcher excludes `/api`.** Every API route must call `getSession()` and check ownership itself. The matcher must also keep excluding static assets (`sw.js`, the manifest, icons, `.mjs` such as the pdf.js worker), or they 307 to `/login`.
- **Tokens without a `jti` skip the sessions-table check on purpose.** Act-as and impersonation use them. Don't "fix" this without handling act-as.
- **The session cookie can be scoped to the parent domain (`SESSION_COOKIE_DOMAIN`) so sibling apps can share the login.** `/api/auth/verify` is the contract those apps call, so don't change its response shape casually. Logout must clear both cookie scopes with raw appended `set-cookie` headers. Why: Next's `cookies().delete()` is keyed by name, so a second call replaces the first.
- **With a parent-domain cookie, `SameSite=lax` does not separate sibling subdomains.** Never put side effects on a GET. New cookie-authenticated state-changing routes should check that the `Origin` host (or `Sec-Fetch-Site: same-origin`) matches.
- **Permissions (`lib/permissions.ts`):** admins hold every permission implicitly and have no rows. Gate the page or UI and the API. Hiding a menu row is not access control. A permission that defaults to granted needs real rows written at registration, in `seedContentOwners`, and once via a numbered migration.
- **SSRF guards (`app/api/image-proxy`, `lib/link-preview.ts`): never add `::ffff:0:0/96` to a `net.BlockList`.** It matches every IPv4 address and silently blocked all public hosts. Test a guard with one public IP and one private IP.
- **Third-party URLs reach an `href` only through `safeHttpUrl` (`lib/safe-url.ts`).** Values that are injected server-side into `<style>` (accent, background) are strict hex or fixed-map CSS only.
- **Passwords use Node scrypt (`lib/password.ts`), with no native bcrypt.** `seedAdmin` only inserts when the email is missing, so changing `ADMIN_PASSWORD` later has no effect on an existing DB.

### Media and files
- **CSP is `img-src 'self' data: blob:` plus OSM tiles, and `media-src 'self' blob:`.** External images must load via `/api/image-proxy?url=...`. Don't add CDN hosts to the CSP. A blocked image looks like a CDN failure because curl fetches the same URL fine.
- **Decide file type from the bytes, never the extension or MIME:** `isHeifBuffer`, `assertRealImage` and `assertRealVideo` in `lib/gallery-storage.ts`. Why: JPEGs arrive named `.heic`, HEIC arrives named `.jpg`, and login walls arrive as HTML with HTTP 200 named `.mp4`.
- **HEIC handling:**
  - Read EXIF and GPS from the original with `exifr`, because heif-convert's JPEG output has null GPS.
  - heif-convert bakes the rotation into the pixels but keeps the orientation tag, so don't auto-orient HEIC again.
  - heif-convert can exit 0 without writing, so verify that the output exists.
- **Originals are never modified; derivatives are regenerated from the original.** Bump `media_version` and append `?v=` to thumb and preview URLs, because media responses carry a day-long private cache. Performer portrait keys are versioned for the same reason.
- **Call `storageRootAvailable()` before any orphan or cleanup sweep.** An unmounted media root makes the whole library look orphaned.
- **`rename` across mounts throws EXDEV.** Keep staging folders on the same mount as their target, or copy, mutate the copy, rename, and unlink the original last.
- **Route handlers keep running after the client disconnects.** Clients give up at about 300 s (undici) or at the proxy, so a retry overlaps the first run and creates duplicates. Long work must start and return (POST starts, GET reports, the UI polls). Keep the in-flight lock in `lib/user-import.ts` (`alreadyRunning`).
- **Use promisified `execFile` (niced) for scan and transcode work, not `execFileSync`.** Sync calls block the event loop, which also runs the WebSocket server. Scan and transcode must not overlap.
- **Never return `Readable.toWeb(...)` from a route: it throws an uncaught `ERR_INVALID_STATE` when the client aborts** (video seeks, scrolling away, cancelled zip downloads). Use `toWebStream(stream, request.signal)` / `fileStream()` from `lib/node-stream.ts`.
- **dHash and SSIM are colour-blind.** Keep the colour-mode check (`sameColourMode` and `MONO_SAT` in `scripts/lib/image-dupe.mjs`) at confirm time, or black-and-white edits get parked as duplicates.
- **Rows with `manual = 1` (performers and links) are owned by humans.** Automatic passes must not delete or overwrite them. Slugs are derived once (`freeSlug`) and never re-derived on rename.

### Next.js, React and UI
- **Every state-driven fullscreen overlay, sheet, lightbox or drill-in calls `useBackDismiss(open, onClose)`** (`lib/use-back-dismiss.ts`). Call it unconditionally, before any early return. Small dropdowns deliberately don't use it.
- **Don't close a `useBackDismiss` overlay and `router.push` in the same handler.** The hook's `history.back()` lands last and rewinds the push. Just navigate and let the unmount clean up. Likewise, `router.refresh()` after closing a sheet can be swallowed, so render from the mutation's response.
- **Don't drive UI state with `router.push('?x=')` while the same page writes the URL with `history.replaceState`.** The router merges stale params. Keep that state on the client and read it back from the live URL on mount.
- **Server components can't pass function props to client components.** Pass a discriminator instead. Pages using `useSearchParams` need a `<Suspense>` boundary or prerender fails. GET handlers that read env need `export const dynamic = "force-dynamic"`, because env is absent at build time.
- **Tailwind is v3 by design, and there is no light mode** (`<html className="dark">`). Snippets from 21st.dev and similar sources ship v4 classes (`bg-linear-to-*`, `outline-hidden`), so convert them. On mobile, keep toolbars icon-only: overflow showed a white strip.
- **Navigation is the bottom bar plus the right drawer only.** No top nav and no per-section pill tabs. Menu props such as `isAdmin` and `showAppstore` travel two chains, `layout → BottomNav → NavMenuSheet` and `messages/page → MessagesShell → MenuTab`, so update both.
- **The WebSocket server does not queue missed messages.** Every subscriber must handle the synthetic `{type: "reconnected"}` event from `ws-provider.tsx` and refetch.
- **The job scheduler (`lib/jobs-runtime.mjs`) ticks only under `server.mjs`** (`npm start` or Docker), never in `next dev`. Anything `server.mjs` imports must be `COPY`'d explicitly in the Dockerfile runner stage, because it is not in `.next`. Whether a job is enabled lives in the DB, so a fresh DB has every job disabled.
- **Dependabot ignores semver-major bumps on purpose** (Tailwind 4, Next 16, the native better-sqlite3 ABI). Majors are deliberate migration branches. Keep `archiver` in `serverExternalPackages`.
- **This repo is public.** Screenshots of 18+ content must be anonymised before they are committed.
