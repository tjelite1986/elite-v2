# BUILD PROMPT — Elite v2 "App Store"

You are working in /home/thomas/code/elite-v2 (Next.js 14 App Router, better-sqlite3,
Tailwind 3 + shadcn/Ark UI, JWT auth via jose, macOS-menu-bar UI). All code, comments,
SQL, error strings and commit messages MUST be in English. Follow the existing module
conventions exactly (mirror the `posts` and `shorts` sections).

## Goal
Build an in-app "App Store" that fits the macOS-desktop metaphor. It is a catalog where
the platform's sections are exposed as installable "apps". Users browse a store, install/
uninstall apps; installed apps drive what shows in their navigation. Admins manage the
catalog (register apps, set category, featured flag, enabled/disabled, sort order).

The Apple menu already has a placeholder item `{ label: 'App Store...', action: 'app-store' }`
in components/ui/mac-os-menu-bar.tsx (~line 122) but it is NOT wired. Wire it to /store.

## 1. Database (edit lib/db.ts ONLY — no separate migration files)
Add to the migrate() block using CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
Use the existing backfill pattern (PRAGMA table_info + ALTER TABLE) for any later column
additions. snake_case columns, WAL already enabled.

Tables:
- apps
    id TEXT PRIMARY KEY              -- stable slug, e.g. "gallery", "shorts"
    name TEXT NOT NULL
    tagline TEXT                     -- short one-liner for cards
    description TEXT                  -- long form for detail page
    category TEXT NOT NULL DEFAULT 'app'   -- e.g. media | social | utilities | adult
    route TEXT NOT NULL              -- where the app opens, e.g. "/gallery"
    icon_key TEXT                    -- lucide icon name OR uploaded asset key
    accent TEXT                      -- hex for card accent, optional
    requires_pin INTEGER NOT NULL DEFAULT 0   -- e.g. shorts18
    is_core INTEGER NOT NULL DEFAULT 0        -- core apps cannot be uninstalled
    featured INTEGER NOT NULL DEFAULT 0
    editors_choice INTEGER NOT NULL DEFAULT 0 -- editorial highlight (separate from featured)
    enabled INTEGER NOT NULL DEFAULT 1        -- admin can hide from store
    sort_order INTEGER NOT NULL DEFAULT 0
    install_count INTEGER NOT NULL DEFAULT 0  -- denormalized (bump on install / decrement on uninstall) -> "Popular"/Trending
    first_published_at TEXT                   -- when it first became enabled -> "New" badge window
    icon_asset_key TEXT              -- uploaded square icon (overrides lucide icon_key)
    current_version TEXT             -- latest version string, e.g. "1.4.0"
    rating_avg REAL NOT NULL DEFAULT 0   -- denormalized cache, recomputed on review write
    rating_count INTEGER NOT NULL DEFAULT 0
    visibility TEXT NOT NULL DEFAULT 'public'  -- public | restricted (see app_access)
    min_role TEXT NOT NULL DEFAULT 'user'      -- user | admin (lowest role allowed to install)
    -- Source / ingestion (where the app + its metadata comes from)
    source TEXT NOT NULL DEFAULT 'internal'    -- internal | github | playstore
    source_repo TEXT                 -- "owner/repo" when source='github'
    source_package TEXT              -- package id when source='playstore', e.g. com.foo.bar
    source_url TEXT                  -- canonical repo / store URL
    developer TEXT                   -- author/developer name pulled from source
    homepage TEXT
    app_type TEXT NOT NULL DEFAULT 'app'   -- app | plugin (plugins are dependencies of apps)
    -- Updates (github-backed apps)
    auto_update INTEGER NOT NULL DEFAULT 0     -- if 1, new GitHub releases are downloaded automatically
    update_available INTEGER NOT NULL DEFAULT 0 -- set by the checker when newer version exists (github OR playstore)
    available_version TEXT           -- newest version seen upstream (Play versionName / GitHub tag);
                                       -- for playstore this is INFORMATIONAL only (no download)
    latest_asset_key TEXT            -- downloaded artifact (e.g. APK) for current_version (github only)
    signing_cert TEXT                -- pinned SHA-256 of the APK signer cert (TOFU; github/fdroid)
    review_flag TEXT                 -- set when a download is rejected, e.g. 'signer_mismatch'
    last_checked_at TEXT             -- last time the update checker ran for this app
    source_meta TEXT                 -- raw JSON blob from source (stars, ratings, install count, etc.)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
- user_app_installs
    user_id INTEGER NOT NULL
    app_id TEXT NOT NULL
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    pinned INTEGER NOT NULL DEFAULT 0         -- pinned to dock/launchpad
    dock_order INTEGER NOT NULL DEFAULT 0     -- user-defined order within the dock
    last_opened_at TEXT                       -- for "Recents" in launchpad
    PRIMARY KEY (user_id, app_id)
    FK user_id -> users(id), FK app_id -> apps(id)
  Index on user_id.
- app_screenshots                   -- gallery shown on the app detail page
    id INTEGER PRIMARY KEY AUTOINCREMENT
    app_id TEXT NOT NULL
    asset_key TEXT NOT NULL          -- stored media key
    caption TEXT
    sort_order INTEGER NOT NULL DEFAULT 0
    FK app_id -> apps(id) ON DELETE CASCADE
  Index on app_id.
- app_versions                      -- changelog / version history + downloadable artifacts
    id INTEGER PRIMARY KEY AUTOINCREMENT
    app_id TEXT NOT NULL
    version TEXT NOT NULL            -- semver-ish string (GitHub tag for github apps)
    notes TEXT                       -- changelog body (GitHub release body for github apps)
    source_tag TEXT                  -- raw GitHub tag / play versionName
    download_url TEXT                -- upstream asset URL (GitHub release asset)
    asset_key TEXT                   -- locally downloaded artifact key (null until downloaded)
    file_size INTEGER                -- bytes of the downloaded asset
    file_name TEXT                   -- original asset filename, e.g. app-release.apk
    downloaded_at TEXT               -- when the asset was fetched to local storage
    sha256 TEXT                      -- hash of the downloaded artifact
    verify_status TEXT               -- ok | hash_mismatch | signer_mismatch | unverifiable
    released_at TEXT NOT NULL DEFAULT (datetime('now'))
    FK app_id -> apps(id) ON DELETE CASCADE
    UNIQUE(app_id, version)
  Index on app_id.
  NOTE: writing a version row should also update apps.current_version to the newest one.
- app_dependencies                  -- "this app needs plugin app X"
    app_id TEXT NOT NULL             -- the app that has the dependency
    depends_on_app_id TEXT NOT NULL  -- the required app (usually app_type='plugin')
    optional INTEGER NOT NULL DEFAULT 0  -- 1 = recommended, 0 = required
    min_version TEXT                 -- minimum version of the dependency, optional
    PRIMARY KEY (app_id, depends_on_app_id)
    FK app_id -> apps(id) ON DELETE CASCADE
    FK depends_on_app_id -> apps(id) ON DELETE CASCADE
  Index on depends_on_app_id (reverse lookup: "what needs this plugin").
- apps_fts                          -- FTS5 virtual table powering search (see §4a)
    CREATE VIRTUAL TABLE apps_fts USING fts5(
      app_id UNINDEXED, name, tagline, description, developer, category, keywords,
      tokenize='unicode61 remove_diacritics 2');
    Keep it in sync with apps via triggers (AFTER INSERT/UPDATE/DELETE on apps) OR rebuild it
    in migrate() if FTS5 is unavailable, fall back to LIKE search (detect with a try/catch on
    a probe CREATE). keywords = a space-joined blob (topics/genre/source_package/repo) for recall.
- collections                       -- editorial / curated shelves (e.g. "Essentials", "Made by us")
    id TEXT PRIMARY KEY              -- slug
    title TEXT NOT NULL
    subtitle TEXT
    kind TEXT NOT NULL DEFAULT 'manual'  -- manual | auto
    auto_rule TEXT                   -- for kind='auto': json {sort, source?, category?, limit}
    hero_asset_key TEXT              -- optional banner image
    sort_order INTEGER NOT NULL DEFAULT 0
    enabled INTEGER NOT NULL DEFAULT 1
- collection_apps                   -- membership for kind='manual'
    collection_id TEXT NOT NULL
    app_id TEXT NOT NULL
    sort_order INTEGER NOT NULL DEFAULT 0
    PRIMARY KEY (collection_id, app_id)
    FK collection_id -> collections(id) ON DELETE CASCADE
    FK app_id -> apps(id) ON DELETE CASCADE
- saved_apps                        -- per-user wishlist / "saved for later"
    user_id INTEGER NOT NULL
    app_id TEXT NOT NULL
    saved_at TEXT NOT NULL DEFAULT (datetime('now'))
    PRIMARY KEY (user_id, app_id)
    FK user_id -> users(id), FK app_id -> apps(id) ON DELETE CASCADE
- search_history                    -- recent searches for typeahead suggestions (optional)
    user_id INTEGER NOT NULL
    query TEXT NOT NULL
    searched_at TEXT NOT NULL DEFAULT (datetime('now'))
  Index on (user_id, searched_at).
- app_reviews                       -- one review per user per app
    id INTEGER PRIMARY KEY AUTOINCREMENT
    app_id TEXT NOT NULL
    user_id INTEGER NOT NULL
    rating INTEGER NOT NULL          -- 1..5, enforce CHECK(rating BETWEEN 1 AND 5)
    body TEXT
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
    updated_at TEXT
    UNIQUE(app_id, user_id)
    FK app_id -> apps(id) ON DELETE CASCADE, FK user_id -> users(id)
  Index on app_id.
  NOTE: on insert/update/delete, recompute apps.rating_avg + apps.rating_count for that app.
- app_access                        -- per-app allowlist when visibility='restricted'
    app_id TEXT NOT NULL
    user_id INTEGER NOT NULL
    granted_at TEXT NOT NULL DEFAULT (datetime('now'))
    PRIMARY KEY (app_id, user_id)
    FK app_id -> apps(id) ON DELETE CASCADE, FK user_id -> users(id)
  A user may install/open a restricted app only if (admin) OR (row exists in app_access).

## 1b. External sources — Google Play + GitHub (lib/sources/)
Admins can register an app from an external source and have its metadata (and, for GitHub,
its release artifacts) pulled in automatically instead of typing everything by hand.

lib/sources/github.ts
  - parseRepo(input)               -- accepts "owner/repo" or any github URL -> { owner, repo }
  - fetchRepoMeta(owner, repo)     -- GET api.github.com/repos/{owner}/{repo}
                                      -> name, description, homepage, stargazers, owner.login,
                                         topics, avatar_url (use as icon fallback), html_url
  - fetchLatestRelease(owner, repo)-- GET /releases/latest -> { tag_name, body, published_at,
                                         assets:[{ name, browser_download_url, size }] }
  - fetchReleases(owner, repo, n)  -- GET /releases?per_page=n for backfilling changelog
  - pickAsset(release, prefer)     -- choose the right asset (prefer .apk, else first asset);
                                      admin can override which asset pattern to track per app
  - Use a GITHUB_TOKEN env var if present (avoid the 60/h unauth rate limit); send
    "Accept: application/vnd.github+json"; handle 404/403/rate-limit with clear errors.

lib/sources/playstore.ts
  - Use the `google-play-scraper` npm package (add to package.json).
  - fetchAppMeta(packageId)        -- title, summary/description, developer, icon, score,
                                      ratings, installs, screenshots[], version, url, genre.
  - fetchAppVersion(packageId)     -- lightweight: return just { version, updatedAt } (uses the
                                      same scraper .app() call but only reads versionName). This
                                      is what the version-check uses so a mass check stays cheap.
  - Play Store apps are METADATA + DEEP-LINK ONLY. We do NOT host or download Play APKs.
    A play app's "Install/Open" button links out to the Play Store URL (open in new tab) and
    its app_type is informational; auto_update does not apply to source='playstore'.
  - Map score/ratings into rating_avg/rating_count for display (clearly marked "Play Store").
  - Some apps report version "Varies with device" — treat that as "unknown", store it in
    available_version, and surface it as an info pill rather than an "update available" flag.

lib/sources/fdroid.ts
  - F-Droid has a clean public index (no scraping). Two options, prefer the per-app JSON:
      * per app:  https://f-droid.org/api/v1/packages/{packageId}      -> { packageName,
                  suggestedVersionCode, packages:[{ versionName, versionCode, ... }] }
      * full meta: https://f-droid.org/repo/index-v2.json (large; cache it) for name,
                  summary, description, author, icon, screenshots, license, source/website.
  - fetchAppMeta(packageId)        -- name, summary, description, author, license, icon URL
                                      (f-droid.org/repo/<pkg>/<icon>), screenshots, web/source URLs.
  - fetchLatestVersion(packageId)  -- { versionName, versionCode, apkName } from the packages API.
  - apkUrl(packageId, apkName)     -- https://f-droid.org/repo/<apkName> (a downloadable APK).
  - F-Droid apps are open APKs, so they support BOTH version-check AND download/auto-update
    (like GitHub) — the artifact is the F-Droid APK. Use versionCode (monotonic int) for the
    "is newer" comparison, not versionName.

lib/sources/ingest.ts  (shared)
  - ingestGithub(repoInput, opts)  -- fetch meta + latest release, upsert an apps row
    (source='github', source_repo, developer, homepage, source_url, icon from avatar or a
    provided one), create/refresh app_versions from releases, set current_version, and (if the
    chosen asset exists) record download_url. Does NOT download bytes here — that is the
    updater's job (see §1c) so ingestion stays fast.
  - ingestPlaystore(packageId)     -- fetch meta, upsert apps row (source='playstore'),
    import screenshots, set developer/homepage/source_url + source_meta JSON.
  - ingestFdroid(packageId)        -- fetch meta + latest version, upsert apps row
    (source='fdroid', source_package=packageId, developer=author, icon, screenshots,
    source_url=f-droid listing), create app_versions row with download_url=apkUrl + the
    versionCode stored in source_tag, set current_version. Like GitHub, the asset is fetched
    later by the updater.
  - All idempotent: re-running refreshes mutable metadata but preserves admin overrides
    (enabled/featured/sort_order/visibility/min_role/category) exactly like seedApps().

## 1c. Update checking + auto-download (GitHub apps)
lib/sources/updater.ts
  - checkApp(appId)                 -- dispatches by apps.source. Always sets last_checked_at.
    * source='github': fetch latest release, compare tag_name vs apps.current_version
      (semver-aware, tolerate leading "v"). If newer:
        - insert an app_versions row (notes = release body, download_url = chosen asset),
        - set apps.update_available = 1, available_version = tag_name,
        - if apps.auto_update = 1 -> immediately downloadAsset() and "promote" (below).
    * source='playstore': fetch only the live version (fetchAppVersion). VERSION-CHECK ONLY —
      never download. If the Play version is newer than apps.current_version:
        - set apps.available_version = <play version>, apps.update_available = 1.
      Otherwise clear update_available. Store updatedAt in source_meta for display. If the
      version is "Varies with device"/unparseable, set available_version but DO NOT raise the
      update_available flag (we cannot compare reliably).
    * source='fdroid': fetch latest version (versionCode/versionName). Compare versionCode vs
      the stored one. If newer: insert an app_versions row (download_url = apkUrl), set
      available_version + update_available = 1, and if auto_update = 1 -> downloadAsset() +
      promote (F-Droid APKs are downloadable like GitHub assets).
  - downloadAsset(appId, versionId)-- stream the GitHub/F-Droid asset to
    STORE_DIR/<app_id>/<version>/<file_name>; on success set app_versions.asset_key,
    file_size, file_name, downloaded_at. Resumable/atomic: download to .part then rename.
    For F-Droid (and any .apk) run verifyApk() BEFORE the rename — a failed check deletes the
    .part, records an error, and does NOT promote.
  - verifyApk(filePath, expected)  -- integrity + signature verification for downloaded APKs:
      * Size + SHA-256: F-Droid's packages API exposes the apk hash; GitHub assets expose
        `size` (and a digest when present) — compare and reject on mismatch.
      * Signing certificate: extract the APK signer cert (apksigner if available, else parse
        the v2/v3 signing block / META-INF cert) and compare its SHA-256 fingerprint to
        apps.signing_cert (pinned on first successful download — TOFU). A DIFFERENT signer on a
        later download is REJECTED (possible repo compromise / package takeover) and the app is
        flagged for admin review instead of promoting.
      * F-Droid publishes the expected signer hash in its index — prefer that as the pin source
        over TOFU when available.
    Record the result (ok | hash_mismatch | signer_mismatch | unverifiable) on the
    app_versions row. apksigner is optional; without the toolchain, fall back to hash-only and
    mark signer 'unverifiable' (never silently pass).
  - promoteVersion(appId, versionId) -- set apps.current_version + latest_asset_key to the
    downloaded version, clear update_available. (Manual "Update now" calls download+promote.)
    REFUSES to promote a version whose verification is hash_mismatch or signer_mismatch.
  - updateAllDownloadable(opts?)    -- for every enabled app with source in ('github','fdroid')
    and update_available = 1: download newest + verify + promote, skipping Play Store apps (no
    artifact) and any that fail verification. Returns { updated[], skipped[], failed[] }. Backs
    the admin "Update all" button and an optional auto-run leg of the timer.
  - checkAll(opts?)                 -- iterate apps respecting a per-app throttle via
    last_checked_at; collect a summary { checked, updated, downloaded, errors }.
    opts.source lets the timer/UI scope a run (e.g. 'playstore' for a Play-only mass check,
    'github' for releases, 'fdroid', or all). Play/F-Droid runs only flag, never download.
  STORE_DIR default: /mnt/4tb/elitev2/appstore (host-owned, dir 777, served via an auth-gated
  download route — NEVER serve the raw path). Mirror the shorts/import storage conventions.

Background job (host systemd timer — same pattern as the shorts transcoder/import timers):
  - scripts/check-app-updates.mjs  -- calls the same logic as checkAll() (import from lib or
    hit an internal admin API with a shared secret). Runs every ~30 min.
  - Provide a .timer + .service unit template in scripts/systemd/ (do NOT auto-install; the
    user installs/enables it like the other elite-v2 host timers).
  - yt-dlp is NOT involved here; downloads are plain HTTPS GETs of GitHub release assets.

Seeding: in createDb()/seedAdmin area, add seedApps(db) that upserts the existing
sections as rows (idempotent INSERT ... ON CONFLICT(id) DO UPDATE for name/route/category
only, NEVER overwriting admin-edited enabled/featured/sort_order). Seed at minimum:
  gallery (/gallery, media, core), posts->"Photos" (/posts, social, core),
  shorts (/shorts, media, core), shorts18->"Shorts 18+" (/shorts18, adult, requires_pin),
  messages (/messages, social, core), people (/people, social, core).
Core apps are auto-installed for every user (treat missing install row for is_core=1 as
installed) so nothing disappears for existing users.

## 2. Library (lib/store.ts)
Business logic, server-only. Functions:
  listApps({ category?, q?, includeDisabled, viewerId?, isAdmin? }) -> App[]
                                   -- filters out restricted apps the viewer cannot access
  getApp(id, { viewerId?, isAdmin? }) -> App | null  (404 if restricted & no access)
  getAppDetail(id, viewerId)       -> { app, screenshots[], versions[], reviews[], myReview }
  listInstalled(userId) -> App[] (core apps always included)
  installApp(userId, appId)        -- 404 if app missing/disabled; 403 if restricted & no access;
                                      403 if app.min_role==='admin' and user is not admin
  uninstallApp(userId, appId)      -- reject if app.is_core (400 "Core apps cannot be removed")
  canAccess(userId, isAdmin, app)  -> boolean (visibility/min_role/app_access gate, reused everywhere)
  markOpened(userId, appId)        -- set last_opened_at = now (called when an app is opened)
  -- Dock / launchpad
  setPinned(userId, appId, pinned)
  reorderDock(userId, orderedAppIds[])   -- writes dock_order
  listDock(userId) -> App[] (pinned, ordered by dock_order)
  listRecents(userId, limit)       -- installed apps by last_opened_at desc
  -- Reviews
  upsertReview(userId, appId, rating, body)  -- enforce 1..5; recompute rating_avg/count
  deleteReview(userId, appId)                -- recompute rating_avg/count
  -- Versions
  listVersions(appId) -> AppVersion[]
  adminAddVersion(appId, version, notes)     -- also bumps apps.current_version
  adminDeleteVersion(versionId)
  -- Screenshots
  listScreenshots(appId) -> AppScreenshot[]
  adminAddScreenshot(appId, assetKey, caption)
  adminDeleteScreenshot(id)
  adminReorderScreenshots(appId, orderedIds[])
  -- Plugin / dependency resolution
  listDependencies(appId) -> { required: App[], optional: App[] }
  listDependents(appId) -> App[]   -- "X, Y need this plugin" (reverse lookup)
  missingDependencies(userId, appId) -> App[]  -- required plugins the user has NOT installed
  installApp(...) above MUST: resolve required dependencies; if any are missing, either
    auto-install installable internal/github plugins OR return 409 with the missing list so
    the UI can prompt "This app needs: <plugin> — install it too?". Block uninstalling a
    plugin that other installed apps still depend on (400 + the dependents list).
  -- External sources (admin, thin wrappers over lib/sources/*)
  adminImportGithub(repoInput, opts) -> App      (ingestGithub)
  adminImportPlaystore(packageId) -> App         (ingestPlaystore)
  adminImportFdroid(packageId) -> App            (ingestFdroid)
  adminSetDependencies(appId, [{ dependsOn, optional, minVersion }])
  -- Updates
  checkForUpdate(appId)            -- single-app version-check (updater.checkApp, any source)
  checkAllUpdates(source?)         -- mass check; source='playstore' = version-flag only
  updateNow(appId)                 -- download + verify + promoteVersion (github/fdroid only)
  updateAllDownloadable()          -- update every github/fdroid app with update_available
                                      (updater.updateAllDownloadable) -> { updated, skipped, failed }
  setAutoUpdate(appId, on)
  -- Catalog + access (admin)
  adminUpsertApp(payload)          -- create/update catalog entry (name/category/route/icon/
                                      accent/requires_pin/featured/enabled/sort_order/
                                      visibility/min_role/tagline/description/app_type/source*)
  adminDeleteApp(appId)
  adminGrantAccess(appId, userId)  / adminRevokeAccess(appId, userId)
  adminListAccess(appId) -> userId[]
Types exported (App, InstalledApp, AppVersion, AppReview, AppScreenshot).
Reuse getSession() from lib/auth.ts in routes, not here. Icon uploads + screenshots reuse
the existing media/asset storage helpers used by posts/gallery — do not invent a new store.

## 3. API (app/api/store/)
Mirror the posts API auth pattern (requireAdmin() helper inline; user routes use getSession()).
  GET  /api/store                 -> list catalog (enabled+accessible only for non-admin), ?category= ?q=
  GET  /api/store/[id]            -> app detail incl. screenshots, versions, rating, myReview
  PUT  /api/store/[id]/install    -> install for current user (enforces access + min_role)
  DELETE /api/store/[id]/install  -> uninstall (block core)
  POST /api/store/[id]/open       -> markOpened (call on navigate); returns { route }
  GET  /api/store/installed       -> current user's installed apps
  -- Dock / launchpad
  PUT  /api/store/[id]/pin        -> { pinned: boolean }
  GET  /api/store/dock            -> pinned apps in dock_order
  PUT  /api/store/dock            -> { orderedAppIds: string[] } reorder
  GET  /api/store/recents         -> recently opened installed apps
  -- Reviews
  PUT  /api/store/[id]/review     -> { rating: 1..5, body? } upsert own review
  DELETE /api/store/[id]/review   -> delete own review
  GET  /api/store/[id]/reviews    -> paginated reviews for the app
  GET  /api/store/[id]/dependencies -> required/optional plugins + which the user is missing
  GET  /api/store/[id]/download    -> auth-gated download of the current/installed artifact
                                      (streams app_versions.asset_key from STORE_DIR; 403 via
                                      access gate; 404 if not downloaded yet)
  --- admin only (requireAdmin -> 403 "Forbidden") ---
  POST   /api/store/admin/apps              -> create/update app (upsert)
  DELETE /api/store/admin/apps/[id]
  POST   /api/store/admin/apps/[id]/versions    -> add version { version, notes }
  DELETE /api/store/admin/apps/[id]/versions/[versionId]
  POST   /api/store/admin/apps/[id]/screenshots -> multipart upload { file, caption }
  DELETE /api/store/admin/apps/[id]/screenshots/[shotId]
  PUT    /api/store/admin/apps/[id]/icon        -> multipart upload square icon
  PUT    /api/store/admin/apps/[id]/dependencies -> set plugin deps [{ dependsOn, optional, minVersion }]
  GET    /api/store/admin/apps/[id]/access      -> list granted users
  PUT    /api/store/admin/apps/[id]/access      -> { userId } grant
  DELETE /api/store/admin/apps/[id]/access/[userId]  -> revoke
  -- External sources + updates (admin)
  POST   /api/store/admin/import/github     -> { repo, iconUrl?, assetPattern? } ingest a repo
  POST   /api/store/admin/import/playstore  -> { packageId } ingest Play metadata
  POST   /api/store/admin/import/fdroid      -> { packageId } ingest F-Droid app
  POST   /api/store/admin/apps/[id]/check   -> version-check this app (dispatches by source;
                                              playstore = flag only, github/fdroid may download on update)
  POST   /api/store/admin/apps/[id]/update  -> download + verify + promote (github/fdroid only)
  PUT    /api/store/admin/apps/[id]/auto-update -> { enabled: boolean } (github/fdroid only)
  POST   /api/store/admin/check-updates     -> run checkAll({ source? }); body { source:
                                              'all'|'github'|'playstore'|'fdroid' } so admins can
                                              mass-check just Play apps. The cron/timer hits this
                                              with a shared-secret header instead of a session.
  POST   /api/store/admin/update-all        -> run updateAllDownloadable() (github/fdroid with
                                              update_available); returns the summary. Also
                                              shared-secret callable for an auto-update timer leg.
  POST   /api/store/admin/apps/[id]/approve-signer -> re-pin signing_cert to the rejected
                                              version's signer, clear review_flag, then allow
                                              promote (deliberate admin override after a
                                              signer_mismatch — e.g. a legitimate key rotation).
All errors: NextResponse.json({ error: "..." }, { status }). English strings.
Image/download routes that serve icons/screenshots/artifacts MUST enforce the same access
gate as the app, and never expose raw STORE_DIR paths.

## 4. Pages (app/(authed)/store/)
  layout.tsx     -> renders <StoreTabs /> shared chrome (copy posts-tabs.tsx style)
  page.tsx       -> store front: featured row + category sections grid (server component,
                    reads listApps + listInstalled, passes to client grid)
  category/[cat]/page.tsx -> filtered grid
  [id]/page.tsx  -> app detail: icon, name, tagline, description, Install/Open/Remove button,
                    "Requires PIN" badge if requires_pin, source badge (Internal / GitHub /
                    Play Store / F-Droid with link out), developer, screenshot carousel, rating
                    summary (avg + count + stars), version history / changelog list (newest
                    first), a "Requires" section listing required/optional plugin apps, a
                    Download button for github/fdroid apps with a downloaded artifact (showing a
                    "Verified" / "Signed by <fingerprint>" badge from verify_status), and the
                    update indicator: for github/fdroid an "Update available -> Update now"
                    banner; for Play Store an INFO pill "Newer version X on Play Store" (you
                    have Y) that links out — no download/update button. Plus a review list +
                    "write a review" box for the current user (upsert their own).
  launchpad/page.tsx -> grid of the user's INSTALLED apps (macOS Launchpad style); drag to
                    reorder writes dock_order; a "Recents" row at top; pin/unpin from here.
  manage/page.tsx -> ADMIN ONLY (check session.role==='admin', redirect '/' otherwise):
                     table of all apps with enabled/featured toggles, sort_order, category,
                     visibility + min_role, create/edit form, delete (non-core). A source
                     badge + "update available" indicator per row (plus a red "needs review"
                     badge when review_flag is set), a toolbar with "Check all updates",
                     "Update all" (downloads+verifies+promotes every github/fdroid app with
                     update_available), and scoped buttons "Check Play versions" (mass
                     version-check of all source='playstore' apps), "Check F-Droid", "Check
                     GitHub", and an "Add app" flow with four tabs: Internal | From GitHub (paste repo/URL,
                     preview metadata, pick asset pattern, toggle auto-update) | From Play Store
                     (paste package id, preview metadata) | From F-Droid (paste package id,
                     preview metadata, toggle auto-update). Per-app editor sub-views (same page
                     or /store/manage/[id]):
                       - upload/replace icon, manage screenshots (add/caption/reorder/delete)
                       - add/delete versions (changelog); "Check for update" + "Update now"
                         ("Update now" hidden for Play Store apps — version-check only)
                       - toggle auto-update (github/fdroid); show last_checked_at +
                         available_version vs current_version + asset info + verify_status;
                         if review_flag set (signer mismatch), show a warning with the pinned
                         vs new signer fingerprint and an "Approve new signer" override (admin)
                       - manage plugin dependencies (add required/optional, min version)
                       - manage restricted-access allowlist (grant/revoke users)
  search/page.tsx -> full search results page (see §4a). Reads ?q=&category=&source=&sort=
                    &filter= from the URL (shareable/bookmarkable), server-renders the first
                    page, client component handles refine + infinite scroll.
StoreTabs items: { Discover: /store, Search: /store/search, Categories: /store/category/media,
Installed: /store/launchpad, Saved: /store/saved, Manage: /store/manage (admin only) }.

## 4a. Search (lib/store-search.ts + UI)
A real, fast, forgiving search — not just a name LIKE. Powers the search bar in the topnav,
a ⌘K command palette, and the /store/search results page.

Backend (lib/store-search.ts):
  searchApps({ q, category?, source?, badge?, installed?, hasUpdate?, sort?, viewerId, isAdmin,
               cursor, limit }) -> { items: App[], nextCursor }
    * Query: FTS5 MATCH over apps_fts with field weighting (name >> tagline >> developer >>
      description) via bm25(); prefix matching ("photo*") for typeahead; tolerate diacritics
      (unicode61 remove_diacritics). Fall back to LIKE across the same columns if FTS5 absent.
    * Filters: category, source (internal|github|playstore|fdroid), badge (new|updated|
      editors_choice|featured), installed (yes/no for viewer), hasUpdate (update_available=1).
    * Sort: relevance (default when q) | rating (rating_avg) | popular (install_count) |
      updated (available_version/last release) | newest (first_published_at) | name.
    * Always passes results through canAccess() — restricted apps the viewer can't see are
      excluded from search too.
    * Keyset/cursor pagination (no OFFSET); stable ordering with id as tiebreaker.
  suggest(qPrefix, viewerId) -> { apps: [{id,name,icon}], categories: [], queries: [] }
    -- typeahead: top app hits + matching category chips + the user's recent search_history.
  recordSearch(viewerId, q) / recentSearches(viewerId) / clearSearchHistory(viewerId).

Discover-from-source (search that can REACH OUT, admin only): when a query has no good local
hits, offer "Search the web stores" -> calls lib/sources to live-search and show importable
results inline:
  searchGithub(q)    -- GET api.github.com/search/repositories?q=...  (top N)
  searchPlaystore(q) -- google-play-scraper search()
  searchFdroid(q)    -- filter the cached F-Droid index by name/summary
Each result has an "Import" button -> the existing admin import endpoints. Non-admins only
search the local catalog.

API:
  GET /api/store/search          -> { items, nextCursor } (params mirror searchApps)
  GET /api/store/search/suggest  -> typeahead payload (debounced client calls, ~150ms)
  GET /api/store/search/sources   -> admin-only live source search { github[], play[], fdroid[] }
  GET /api/store/search/history  / DELETE to clear

UI:
  store-search-bar.tsx   -> topnav search input with live suggest dropdown (apps/categories/
                            recents), keyboard nav (↑↓ + Enter), "/" focuses it.
  command-palette.tsx    -> ⌘K / Ctrl-K global palette: search apps, jump to sections, run
                            actions (Open, Install, Save). Mounted once in the (authed) layout.
  store-search-results.tsx-> results grid + a filter rail (category, source, badge, has-update,
                            installed) + sort dropdown; infinite scroll; empty state offers the
                            source search to admins. URL is the source of truth (useSearchParams).

## 4b. Layout & UX (make it feel like a real App Store)
Replace the flat grid with an editorial, shelf-based Discover page and a richer detail page.
Keep the existing macOS glassmorphic language (backdrop-blur, rounded-2xl, hairline borders,
the mac-os-menu-bar palette). Dark-mode first, fully responsive, reduced-motion aware.

Discover (/store page.tsx) is composed of stacked "shelves":
  - Hero carousel: featured apps / editorial collections (hero_asset_key), auto-rotating,
    swipeable, with dots; respects prefers-reduced-motion.
  - "Editor's Choice" shelf (editors_choice apps).
  - Auto shelves rendered from collections kind='auto': "New" (first_published_at recent),
    "Recently updated" (available_version/last release), "Popular" (install_count), and one
    per top category. Horizontal scroll rows (snap), each with a "See all" -> category/search.
  - Manual collections (kind='manual') as their own shelves with subtitle + optional banner.
  - Each shelf uses a consistent <Shelf title seeAllHref>{cards}</Shelf> wrapper.

App card variants (one component, size prop): 'tile' (grid), 'row' (shelf, wider w/ tagline),
'hero' (big banner). Show badges: New / Updated / Editor's Choice / source pill / 18+; star
rating; install state (Get / Open / spinner). Skeleton loaders while fetching.

App detail (/store/[id]) richer header: large icon, name, developer (link to dev's other
apps), category + source pills, rating with histogram, primary Get/Open + Save (wishlist) +
Share. Sticky action bar on scroll. Sections: screenshots carousel (lightbox), description
(clamp + "more"), What's New (latest version notes), Information (version, size, updated,
license, source link), Requires (plugins), Ratings & Reviews (summary + list + write box),
"You might also like" (same category/developer). Breadcrumb back to category.

Categories (/store/category/[cat]): hero + that category's apps with the same filter rail as
search. Sidebar or chip list of all categories (icon per category).

Saved (/store/saved): the user's wishlist grid. Launchpad stays as the installed-apps view.

Polish: optimistic install/save with toast + undo; loading skeletons everywhere; empty states
with a helpful CTA; keyboard accessible (focus rings, ESC closes palette/lightbox); page
transitions subtle; all copy in English.

## 4c. Suggested extras (recommended, build if in scope)
  - Update notifications: when the checker flags update_available for an app a user has
    installed, push to the existing NotificationBell (and optionally notify.mobile_app_* via
    the elite notification path) — "Update available for <app>". One per app per version.
  - "Needs review" admin alert when a signer_mismatch sets review_flag.
  - Badges system is data-driven (New/Updated/Editor's Choice/Popular) so shelves + filters
    reuse the same predicates — keep them in one place (lib/store-badges.ts).
  - Saved/wishlist quick-add from any card (bookmark icon), surfaced in /store/saved + palette.
  - Per-developer page /store/dev/[name] grouping all apps by that developer.
  - Admin: collections editor (create/curate manual shelves, reorder, set hero), and an
    install/version audit log for visibility.
  - Health check: flag apps whose source 404s on the last check (broken repo/removed package)
    so admins can prune them; show a subtle "unavailable" state instead of a dead Get button.

## 5. Components (components/)
  store-grid.tsx        -> responsive grid of <AppCard/>
  app-card.tsx          -> single component, variant prop 'tile'|'row'|'hero'; icon, name,
                           tagline, badges (New/Updated/Editor's Choice/18+/source), star
                           rating, Get/Open + Save; optimistic state; skeleton variant
  shelf.tsx             -> <Shelf title seeAllHref> horizontal snap-scroll row of cards
  hero-carousel.tsx     -> featured/collection hero banners, auto-rotate, dots, reduced-motion
  store-discover.tsx    -> composes hero + shelves for the Discover page
  app-detail.tsx        -> rich detail: sticky action bar, hero header, screenshots(lightbox),
                           What's New, Information, Requires, ratings histogram, reviews, "more like this"
  app-screenshot-carousel.tsx -> swipeable gallery + lightbox
  app-rating.tsx        -> star display (read) + interactive star input (write)
  app-review-list.tsx   -> reviews with author, stars, body, date
  app-review-form.tsx   -> 1..5 stars + textarea, upserts the current user's review
  app-version-list.tsx  -> changelog entries (version, date, notes, verify_status badge)
  app-badges.tsx        -> data-driven badge pills (shared predicates with shelves/filters)
  save-button.tsx       -> wishlist bookmark toggle (saved_apps), optimistic + toast
  store-search-bar.tsx  -> topnav search with live suggest dropdown + keyboard nav ("/" focus)
  command-palette.tsx   -> ⌘K/Ctrl-K global palette (search apps, jump, run actions)
  store-search-results.tsx -> results grid + filter rail + sort dropdown + infinite scroll
  category-nav.tsx      -> category chips/sidebar with per-category icons
  store-dock.tsx        -> compact pinned-apps strip (used in topnav/dock if wired)
  launchpad-grid.tsx    -> installed-apps grid with drag-reorder (dock_order) + Recents row
  app-source-badge.tsx  -> Internal / GitHub / Play Store / F-Droid pill (with outbound link)
  app-dependencies.tsx  -> "Requires" section: required/optional plugins + install prompts
  app-update-banner.tsx -> github/fdroid: "Update available -> Update now"; playstore: info pill
                           "Newer version on Play Store" (link out, no update button)
  store-import-form.tsx -> admin: GitHub/Play/F-Droid import with live metadata preview + source search
  store-collections-editor.tsx -> admin: create/curate manual collections, reorder, set hero
  store-manage.tsx      -> admin client component (catalog table + form + toggles + toolbar)
  store-app-editor.tsx  -> admin per-app editor: icon upload, screenshot manager,
                           version manager, dependency manager, update controls, access allowlist
Use the existing glassmorphic/tailwind look (backdrop-blur, rounded-2xl, subtle borders)
consistent with mac-os-menu-bar.tsx and the posts cards. lucide-react for icons. For
drag-reorder reuse whatever the project already uses; if none, plain HTML5 drag events.

## 6. Navigation wiring
- components/top-nav.tsx: in handleAction(), add
    if (action === "app-store") router.push("/store");
  and add a top-level menu entry { label: "App Store", action: "app-store" } (place near
  Dashboard). Keep the Apple-menu "App Store..." item working too (it already emits
  'app-store').
- Dock: render <StoreDock/> (pinned apps in dock_order) in the topnav right slot OR as a
  thin bar; clicking an app calls /open (markOpened) then routes to app.route. Keep it
  lightweight; the full reorder UX lives in /store/launchpad.
- Search: mount <CommandPalette/> once in app/(authed)/layout.tsx (global ⌘K/Ctrl-K). Add
  <StoreSearchBar/> to the topnav (or at least on /store pages). "/" focuses the search bar.

## 7. Constraints & checks
- Core apps (is_core=1) must never be uninstallable and must always appear installed.
- shorts18 in the store must show a "Requires PIN" badge; opening it still goes through the
  existing middleware PIN gate — do not re-implement the gate.
- Access gate (canAccess) is the single source of truth and MUST be enforced everywhere:
  catalog listing, app detail, install, open, and the icon/screenshot image routes.
  visibility='restricted' => needs app_access row (or admin); min_role='admin' => admin only.
- Ratings: one review per (user, app); rating 1..5 enforced in DB CHECK and validated in the
  API. apps.rating_avg/rating_count are caches — recompute on every review write/delete.
- Versions: adding a version updates apps.current_version to the newest; the changelog list
  is newest-first. Deleting the newest version should re-point current_version to the next.
- Dependencies/plugins: installing an app must resolve required plugins (auto-install the
  installable ones or prompt with the missing list, 409); a plugin cannot be uninstalled
  while an installed app still requires it (400 + dependents). Avoid dependency cycles.
- External sources: GitHub + Play + F-Droid ingestion is idempotent and never clobbers admin
  overrides. GitHub/F-Droid asset downloads are atomic (.part -> rename) into STORE_DIR and
  served only through the auth-gated /download route. Play Store apps are metadata + deep-link
  + version-check only (no hosting, no download). Always send a User-Agent + optional
  GITHUB_TOKEN; handle rate limits and 404s gracefully.
- Version comparison: GitHub by semver tag, Play by versionName (semver-ish; skip "Varies with
  device"), F-Droid by integer versionCode (authoritative). Play/F-Droid mass checks scope via
  checkAll({ source }); Play check only flags update_available + available_version, never
  downloads. available_version is shown next to current_version so the user sees "have Y, X
  available" without any download happening.
- APK verification: every downloaded .apk is hash-checked AND signer-checked before promote.
  The signer cert is pinned on first download (TOFU; prefer F-Droid's published signer hash);
  a later signer mismatch is REJECTED, sets review_flag, and requires an explicit admin
  "Approve new signer" override. promoteVersion refuses hash_mismatch/signer_mismatch. If
  apksigner is unavailable, fall back to hash-only and mark signer 'unverifiable' — never
  silently pass. "Update all" and the auto-update timer skip any app that fails verification.
- The update timer endpoint authenticates with a shared secret header (not a user session)
  so the host systemd timer can call it; never expose update/download of restricted apps
  past the access gate.
- Search MUST honor canAccess (restricted apps the viewer can't see never appear in results,
  suggest, or the command palette). FTS5 stays in sync with apps via triggers; if FTS5 is
  unavailable the LIKE fallback must return the same shape. Pagination is keyset/cursor, not
  OFFSET. Live source search (github/play/fdroid) is admin-only. Badge predicates live in ONE
  place (lib/store-badges.ts) and are reused by shelves, filters and cards so they never drift.
- Don't break existing routes/middleware. Admin gating must exist at BOTH middleware level
  (if you add /store/manage to the /admin-style checks) and API level (requireAdmin()).
- After building: run the app, verify `npm run build` passes, and confirm:
    * a normal user can install/uninstall a non-core app,
    * pin an app and see it in the dock + reorder it in /store/launchpad,
    * leave a 1..5 star review and see rating_avg update,
    * an admin can import a GitHub repo, see its release as a version, "Update now" downloads
      the asset, and the Download button serves it through the auth gate,
    * an admin can import a Play Store package (metadata + screenshots, link-out only) and run
      "Check Play versions" so apps with a newer Play versionName show "update available"
      (info pill, no download button),
    * an admin can import an F-Droid package, "Check for update" detects a higher versionCode,
      and "Update now" downloads + verifies (hash + signer) the F-Droid APK, serving it through
      the auth-gated download route; a tampered/re-signed APK is rejected with a "needs review"
      flag and only promotes after "Approve new signer",
    * "Update all" downloads+verifies+promotes every github/fdroid app with update_available
      and reports updated/skipped/failed,
    * installing an app that declares a required plugin prompts/auto-installs the plugin,
    * an admin can create an app, upload an icon + screenshots, add a version, set a plugin
      dependency, and grant a restricted app to a specific user in /store/manage,
    * search returns relevant results with prefix + diacritic tolerance, filters by
      category/source/badge, sorts by relevance/rating/popular/updated/newest, and a restricted
      app is absent for a user without access,
    * ⌘K opens the command palette and "/" focuses the search bar,
    * the Discover page renders hero + shelves (New / Recently updated / Popular / categories /
      manual collections), and Save adds an app to /store/saved.

## 8. New environment variables
  STORE_DIR=/mnt/4tb/elitev2/appstore      # downloaded artifacts (host-owned, dir 777)
  GITHUB_TOKEN=...                          # optional, raises GitHub API rate limit
  APP_UPDATE_SECRET=...                     # shared secret for the timer -> check-updates route
  FDROID_REPO_URL=https://f-droid.org/repo  # optional, override to use a custom/mirror F-Droid repo
Add these to .env at /home/thomas/docker2/compose/elitev2/.env and mount STORE_DIR as a
bind mount in the compose file (like the shorts/import dirs).

## 9. New dependencies (package.json)
  google-play-scraper        # Play Store metadata
  semver                     # version comparison for the update checker
(GitHub + F-Droid + all downloads use built-in fetch — no extra dep. better-sqlite3
multi-stage build already handles native modules; rebuild with --no-cache only because
package.json changed. Search needs NO extra dep: FTS5 ships in better-sqlite3's bundled
SQLite — probe for it at migrate() time and fall back to LIKE if a build lacks it.)
APK signer verification: prefer `apksigner` (Android build-tools, present on the host at
/home/thomas/android-sdk but NOT in the runtime container). Either (a) install apksigner +
a JRE into the Docker image, or (b) implement a pure-Node v2/v3 APK signing-block + cert
SHA-256 parser (no extra npm dep needed). If neither is available, hash-only fallback marks
the signer 'unverifiable'. Document which path was chosen.

## 10. Complete file structure (new + touched files)
elite-v2/
├── app/
│   ├── (authed)/
│   │   └── store/
│   │       ├── layout.tsx                     # StoreTabs chrome
│   │       ├── page.tsx                        # Discover: hero + shelves (collections)
│   │       ├── search/page.tsx                 # full search results (filters + sort + infinite scroll)
│   │       ├── category/[cat]/page.tsx         # category hero + filtered grid
│   │       ├── dev/[name]/page.tsx             # all apps by a developer
│   │       ├── saved/page.tsx                  # wishlist
│   │       ├── [id]/page.tsx                   # rich app detail
│   │       ├── launchpad/page.tsx              # installed apps, drag-reorder + Recents
│   │       └── manage/
│   │           ├── page.tsx                    # admin catalog table + Add app (4 tabs) + toolbar
│   │           ├── collections/page.tsx        # admin collections editor
│   │           └── [id]/page.tsx               # admin per-app editor (optional split)
│   └── api/
│       └── store/
│           ├── route.ts                        # GET catalog
│           ├── installed/route.ts              # GET installed
│           ├── saved/route.ts                  # GET wishlist
│           ├── collections/route.ts            # GET shelves for Discover
│           ├── dock/route.ts                   # GET/PUT dock + order
│           ├── recents/route.ts                # GET recents
│           ├── search/
│           │   ├── route.ts                    # GET search results (FTS + filters + sort + cursor)
│           │   ├── suggest/route.ts            # GET typeahead payload
│           │   ├── sources/route.ts            # GET admin live source search (github/play/fdroid)
│           │   └── history/route.ts            # GET recent / DELETE clear
│           ├── [id]/
│           │   ├── route.ts                    # GET detail
│           │   ├── install/route.ts            # PUT/DELETE install
│           │   ├── open/route.ts               # POST markOpened
│           │   ├── pin/route.ts                # PUT pin
│           │   ├── save/route.ts               # PUT/DELETE wishlist
│           │   ├── review/route.ts             # PUT/DELETE own review
│           │   ├── reviews/route.ts            # GET reviews
│           │   ├── dependencies/route.ts       # GET deps + missing
│           │   └── download/route.ts           # GET auth-gated artifact
│           └── admin/
│               ├── apps/
│               │   ├── route.ts                # POST upsert
│               │   └── [id]/
│               │       ├── route.ts            # DELETE
│               │       ├── icon/route.ts       # PUT icon upload
│               │       ├── versions/route.ts   # POST version
│               │       ├── versions/[versionId]/route.ts  # DELETE version
│               │       ├── screenshots/route.ts            # POST screenshot
│               │       ├── screenshots/[shotId]/route.ts   # DELETE screenshot
│               │       ├── dependencies/route.ts           # PUT deps
│               │       ├── access/route.ts                 # GET/PUT access
│               │       ├── access/[userId]/route.ts        # DELETE access
│               │       ├── check/route.ts      # POST check-for-update
│               │       ├── update/route.ts     # POST download + verify + promote
│               │       ├── approve-signer/route.ts # POST re-pin signer + clear review_flag
│               │       └── auto-update/route.ts# PUT toggle
│               ├── import/
│               │   ├── github/route.ts         # POST ingest repo
│               │   ├── playstore/route.ts      # POST ingest package
│               │   └── fdroid/route.ts         # POST ingest F-Droid package
│               ├── check-updates/route.ts      # POST checkAll({ source? }) (shared-secret or admin)
│               ├── update-all/route.ts         # POST updateAllDownloadable() (shared-secret or admin)
│               └── collections/route.ts        # POST/PUT/DELETE manage collections + membership
├── components/
│   ├── store-tabs.tsx
│   ├── store-grid.tsx
│   ├── app-card.tsx
│   ├── shelf.tsx
│   ├── hero-carousel.tsx
│   ├── store-discover.tsx
│   ├── app-detail.tsx
│   ├── app-screenshot-carousel.tsx
│   ├── app-rating.tsx
│   ├── app-review-list.tsx
│   ├── app-review-form.tsx
│   ├── app-version-list.tsx
│   ├── app-badges.tsx
│   ├── save-button.tsx
│   ├── store-search-bar.tsx
│   ├── command-palette.tsx
│   ├── store-search-results.tsx
│   ├── category-nav.tsx
│   ├── app-source-badge.tsx
│   ├── app-dependencies.tsx
│   ├── app-update-banner.tsx
│   ├── store-dock.tsx
│   ├── launchpad-grid.tsx
│   ├── store-import-form.tsx
│   ├── store-collections-editor.tsx
│   ├── store-manage.tsx
│   └── store-app-editor.tsx
├── lib/
│   ├── store.ts                                # all store business logic
│   ├── store-search.ts                         # FTS5 search + suggest + source search
│   ├── store-badges.ts                         # shared New/Updated/Popular/Editor's Choice predicates
│   └── sources/
│       ├── github.ts                           # repo + release fetch
│       ├── playstore.ts                        # google-play-scraper wrapper (meta + version-check)
│       ├── fdroid.ts                            # F-Droid index/packages API (meta + version + APK)
│       ├── ingest.ts                           # ingestGithub / ingestPlaystore / ingestFdroid
│       └── updater.ts                          # checkApp / downloadAsset / promote / checkAll({source})
├── scripts/
│   ├── check-app-updates.mjs                   # host timer entrypoint
│   └── systemd/
│       ├── elitev2-app-updates.service         # template (not auto-installed)
│       └── elitev2-app-updates.timer           # template (every ~30 min)
├── lib/db.ts                                   # TOUCHED: new tables/columns + FTS5 + seedApps()
├── app/(authed)/layout.tsx                     # TOUCHED: mount <CommandPalette/> (global ⌘K)
├── components/top-nav.tsx                      # TOUCHED: wire 'app-store' + dock + <StoreSearchBar/>
├── components/ui/mac-os-menu-bar.tsx           # TOUCHED: keep 'App Store...' action
├── middleware.ts                               # TOUCHED if /store/manage added to admin checks
├── package.json                                # TOUCHED: google-play-scraper, semver
└── docs/app-store-build-prompt.md              # this spec
Host (outside repo):
  /mnt/4tb/elitev2/appstore/<app_id>/<version>/<file>   # downloaded artifacts (STORE_DIR)
  /home/thomas/docker2/compose/elitev2/.env             # new env vars + STORE_DIR bind mount

## Deploy reminder (do not run unless asked)
Build & restart from /home/thomas/docker2/compose/elitev2 (NOT the repo dir):
  docker compose build && docker compose up -d
Only --no-cache if package.json changed. better-sqlite3 needs the multi-stage build.
