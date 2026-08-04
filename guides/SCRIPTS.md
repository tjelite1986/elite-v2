# Scripts reference

Every script in `scripts/`, what it does, and how it runs. Unless noted, the
`.mjs` scripts run **inside** the `elitev2` container (they need its
`better-sqlite3`, `ffmpeg`, `yt-dlp` and the storage mounts) and are invoked
one of three ways:

- **In-app scheduler** — **Settings → Background jobs** (see the
  [README](../README.md#background-jobs-optional--only-for-a-real-server)).
- **systemd timer** — a host timer that `docker exec`s the script
  (`deploy/systemd/`, `scripts/systemd/`).
- **Admin button** — a one-off run triggered from the UI.

Pick the in-app scheduler **or** a systemd timer for a given job, never both.

## Recurring pipeline jobs

These map 1:1 to rows in **Settings → Background jobs** (job id in parentheses).

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
| `normalize-import-images.mjs` | Import image normalize (`import-normalize`) | Converts HEIC and fixes mislabeled extensions in the user import folders, so an import never fails on a file the decoder can't read. |
| `db-maintenance.mjs` | Database maintenance (`db-maintenance`) | WAL checkpoint (TRUNCATE) + planner statistics refresh; warns when the WAL cannot shrink. |
| `backup-db.mjs` | Database backup (`db-backup`) | `VACUUM INTO` a timestamped copy in `BACKUP_DIR`, then prune all but the newest `BACKUP_KEEP` (default 14). VACUUM INTO snapshots committed data correctly under WAL, unlike copying the file. |

The rest of the jobs have **no script** — they're in-app HTTP endpoints the
scheduler posts to over loopback, gated by `IMPORT_CRON_SECRET`:

| Job | Endpoint | What it does |
| --- | -------- | ------------ |
| Shorts cleanup (`shorts-cleanup`) | `/api/shorts/maintenance?action=all` | Remove shorts whose file is gone; prune empty playlists. |
| Posts cleanup (`posts-cleanup`) | `/api/posts/maintenance?action=all` | Remove post images whose file is gone; prune empty posts. |
| Gallery cleanup (`gallery-cleanup`) | `/api/gallery/maintenance?action=all` | Remove gallery entries whose file is gone. |
| Video library scan (`videos-scan`) | `/api/videos/scan` | Mirror `VIDEOS_ROOT/{main,adults}` into the library: add new files, refresh changed ones, generate posters/storyboards, drop rows whose file is gone. |
| Video transcode (`videos-transcode`) | `/api/videos/transcode` | Convert library videos a browser can't play (HEVC, AC-3, `.mkv`/`.avi`) to H.264/AAC MP4. Returns as soon as the run *starts* — an encode outlives any HTTP request — and works the queue within a time budget, spreading a backlog over several runs. |
| Video metadata match (`videos-metadata`) | `/api/videos/metadata` | Match 18+ library videos to metadata: a `.nfo` sidecar next to the file when there is one (Whisparr/Stash layouts), otherwise a ThePornDB lookup (`TPDB_API_KEY`) that only auto-applies confident matches. |
| App Store folder import (`appstore-import`) | `/api/store/admin/import/folder` | Import APKs dropped in the store import folder; unmatched files go to the review queue. |

## Instagram helper (not a job)

| Script | What it does |
| ------ | ------------ |
| `ig_profile.py` | Instagram profile-info + existence engine (Instaloader), called by `lib/instagram.ts`, not scheduled. Loads a Netscape `cookies.txt`, supports a **multi-cookie pool** (root `cookies.txt` = id `default` plus one per subfolder) with per-account cooldown on blocks. Modes: `login-check`, `pool-status`, `user <name>`, `batch`. See [COOKIES.md](COOKIES.md). |

## Jobs with no script of their own

| Job | How it runs | What it does |
| --- | ----------- | ------------ |
| User folder import (`user-import`) | Loopback POST to `/api/import/user-folders`, gated by `IMPORT_CRON_SECRET` | Imports the per-user drop trees (`u_<user>/{gallery,posts,shorts,shorts18,books}`). Also triggerable by hand from **Settings → Photos → Import → Per-user folder import**. A `deploy/systemd/elitev2-user-import.*` unit exists for host-level scheduling. |
| `fetch-shorts-titles.mjs` | Spawned detached by the admin "Fetch original titles" button | Bulk-fetches real titles via `yt-dlp` for shorts with missing/truncated captions. Not scheduled. |

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
| `backfill-blurhash.mjs` | Compute the BlurHash placeholder for gallery images stored before blurhashes existed. |
| `backfill-shorts-captions.mjs` | Re-read each clip's `Source:` URL to recover a missing caption. Never re-downloads the media. |
| `seed-sandbox-captions.mjs` | Seed the sandbox instance with placeholder captions so screenshots contain no real content. |

## Installer

| Script | What it does |
| ------ | ------------ |
| `setup.sh` | Interactive installer (dialog UI): creates the storage roots, generates a `.env` with auto-filled secrets, and writes a matching `docker-compose.yml` — optionally also Traefik, grabbit and the App Store update timer. See [SETUP.md](SETUP.md). |

## Dev / verification

| Script | What it does |
| ------ | ------------ |
| `verify-jobs-panel.mjs` | End-to-end check of **Settings → Background jobs** against a running instance (logs in as admin, reads each job row, screenshots the section). |

## The `lib/` subfolder

`scripts/lib/` holds shared helpers imported by the scripts above:

- `image-dupe.mjs` — the dHash + SSIM two-stage duplicate detector shared by all
  three dupe scanners.
- `hash-worker.mjs` — worker-thread hashing, so a scan doesn't block the
  scheduler's event loop.

Not run directly.
