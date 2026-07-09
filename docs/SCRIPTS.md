# Scripts reference

Every script in `scripts/`, what it does, and how it runs. Unless noted, the
`.mjs` scripts run **inside** the `elitev2` container (they need its
`better-sqlite3`, `ffmpeg`, `yt-dlp` and the storage mounts) and are invoked
one of three ways:

- **In-app scheduler** — **Admin → Background jobs** (see the
  [README](../README.md#background-jobs-optional--only-for-a-real-server)).
- **systemd timer** — a host timer that `docker exec`s the script
  (`deploy/systemd/`, `scripts/systemd/`).
- **Admin button** — a one-off run triggered from the UI.

Pick the in-app scheduler **or** a systemd timer for a given job, never both.

## Recurring pipeline jobs

These map 1:1 to rows in **Admin → Background jobs** (job id in parentheses).

| Script | Job | What it does |
| ------ | --- | ------------ |
| `import-shorts.mjs` | Shorts import — 18+ (`shorts-import-18`) and main (`shorts-import-main`, run with `IMPORT_CHANNEL=main`) | Auto-sorts files dropped in `SHORTS_ROOT/<channel>/_import/` into the shorts library: parses creator/title/hashtags from the filename, creates the profile + poster, inserts the DB row. |
| `poll-shorts.mjs` | Shorts auto-poll (`shorts-poll`) | For every `short_profiles` row with `auto_poll=1`, fetches the latest clips from its source and downloads new ones as `pending`, leaving the transcoder to finish them. |
| `transcode-shorts.mjs` | Shorts transcode (`shorts-transcode`) | Turns each non-`.web.mp4` short into a web-optimized `.web.mp4` (H.264/AAC, faststart); marks it `ready`. |
| `scan-shorts-duplicates.mjs` | Shorts duplicate scan (`shorts-dupescan`) | Groups duplicate clips (dHash candidate + confirm) and marks the best copy to keep. **Never deletes** — an admin reviews. |
| `scan-posts-duplicates.mjs` | Posts duplicate scan (`posts-dupescan`) | Same, for the posts photo library. |
| `scan-gallery-duplicates.mjs` | Gallery duplicate scan (`gallery-dupescan`) | Same, for the per-user gallery. |
| `import-posts.mjs` | Posts import (`posts-import`) | Auto-sorts files dropped in `POSTS_ROOT/_import/` into the posts module (top-level files encode the creator; subfolders group carousels). |
| `instagram-sync.mjs` | Instagram sync (`instagram-sync`) | Per-profile Instagram poller: downloads new media via `gallery-dl` for each profile with a connected IG source. Needs a cookie — see [COOKIES.md](COOKIES.md). |
| `tiktok-sync.mjs` | TikTok sync (`tiktok-sync`) | Per-profile TikTok poller (`gallery-dl` → `yt-dlp` fallback). Cookie-optional. |
| `cleanup-stories.mjs` | Stories cleanup (`stories-cleanup`) | Deletes expired stories (rows + files); stories live 24h. |
| `check-app-updates.mjs` | App Store update check (`app-updates`) | Host-side checker that calls the admin check-updates endpoint with `APP_UPDATE_SECRET`; optionally auto-downloads new GitHub/F-Droid releases (promoted only if APK signature verification passes). |

Three cleanup jobs have **no script** — they're in-app HTTP maintenance
endpoints called by the scheduler, gated by `IMPORT_CRON_SECRET`:

| Job | Endpoint | What it does |
| --- | -------- | ------------ |
| Shorts cleanup (`shorts-cleanup`) | `/api/shorts/maintenance?action=all` | Remove shorts whose file is gone; prune empty playlists. |
| Posts cleanup (`posts-cleanup`) | `/api/posts/maintenance?action=all` | Remove post images whose file is gone; prune empty posts. |
| Gallery cleanup (`gallery-cleanup`) | `/api/gallery/maintenance?action=all` | Remove gallery entries whose file is gone. |

## Instagram helper (not a job)

| Script | What it does |
| ------ | ------------ |
| `ig_profile.py` | Instagram profile-info + existence engine (Instaloader), called by `lib/instagram.ts`, not scheduled. Loads a Netscape `cookies.txt`, supports a **multi-cookie pool** (root `cookies.txt` = id `default` plus one per subfolder) with per-account cooldown on blocks. Modes: `login-check`, `pool-status`, `user <name>`, `batch`. See [COOKIES.md](COOKIES.md). |

## systemd-only jobs

| Script | Unit | Why it's not in the app panel |
| ------ | ---- | ----------------------------- |
| the per-user drop-folder import | `deploy/systemd/elitev2-user-import.*` | It fixes file ownership on the **host** before importing — access the app process doesn't have. Trigger manually from **Admin → Per-user folder import**. |
| `fetch-shorts-titles.mjs` | (spawned detached by the admin "Fetch original titles" button) | Bulk-fetches real titles via `yt-dlp` for shorts with missing/truncated captions. |

## One-off migrations & seeds

Run once by hand (`docker exec elitev2 node scripts/<name>.mjs`) during
specific data migrations — **not** scheduled. Kept for reference / re-runs.

| Script | What it did |
| ------ | ----------- |
| `import-elite-instagram.mjs` | Seed: import a legacy on-disk Instagram library (per-creator folders) into posts as mirrored creators. |
| `import-elite-shortvideos.mjs` | Seed: import the legacy elite shortvideos library into the shorts "main" channel. |
| `regroup-posts-carousels.mjs` | Regroup already-imported single-image posts into date-grouped carousels, without re-encoding. |
| `migrate-loose-uploads.mjs` | Move per-user shorts stored loose (no subfolder) into a creator/`uploads` subfolder. |
| `migrate-shorts-folders.mjs` | Reorganize flat shorts storage into per-profile subfolders and rewrite the DB keys. Idempotent. |

## Dev / verification

| Script | What it does |
| ------ | ------------ |
| `verify-jobs-panel.mjs` | End-to-end check of **Admin → Background jobs** against a running instance (logs in as admin, reads each job row, screenshots the section). |

## The `lib/` subfolder

`scripts/lib/` holds shared helpers imported by the scripts above — notably
`image-dupe.mjs` (the dHash + SSIM two-stage duplicate detector shared by all
three dupe scanners). Not run directly.
