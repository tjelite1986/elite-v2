# Full setup guide

The complete path from zero to a running Elite v2 stack — the app itself, the
optional [grabbit](https://github.com/tjelite1986/grabbit) media grabber, the
background jobs, and where every kind of data lives. For a quick local
try-out, the [README's Getting started](../README.md#getting-started) is all
you need; this guide is for a real server install.

Related guides:

- [COOKIES.md](COOKIES.md) — exporting and installing the cookies the
  Instagram / TikTok sync needs (desktop and Android).
- [SCRIPTS.md](SCRIPTS.md) — what every script in `scripts/` does and how it
  is triggered.

## 1. The moving parts

| Part | What it is | Required? |
| ---- | ---------- | --------- |
| `elitev2` container | The Next.js app + WebSocket server (`server.mjs`), SQLite DB | Yes |
| Traefik | Reverse proxy terminating TLS in front of the container | Yes (or any proxy) |
| Storage roots | Host folders bind-mounted into the container for media | Yes |
| `grabbit` container | Optional media grabber behind the shorts "Grab from web" button | No |
| Background jobs | Import / poll / transcode / cleanup — in-app scheduler or systemd timers | Recommended |
| Cookies | `cookies.txt` files for the Instagram (required) / TikTok (optional) sync | Only for sync |

## 2. Prerequisites

- Docker + Docker Compose.
- A Traefik instance on a shared external Docker network (called `traefik`
  below) with an HTTPS entrypoint and a certificate resolver. The
  [README's Deployment section](../README.md#deployment) shows the exact
  labels; a from-scratch Traefik walkthrough is in the
  [elite-docs-library](https://github.com/tjelite1986/elite-docs-library)
  guides.
- A data disk for media. Below it is `/mnt/data` — substitute your own.

## 3. Host folder layout

Create the storage roots up front. The container writes as a non-root user,
so make them writable (`chmod -R 777` is the blunt fix):

```
/mnt/data/elitev2/
├── profile/      # PROFILE_ROOT  — per-user served media (u_<user>/{gallery,posts,shorts,shorts18,cookies})
├── import/       # IMPORT_ROOT   — per-user drop tree (staging, see README "drop folders")
├── posts/        # POSTS_ROOT    — mirrored-creator posts media
├── shorts/       # SHORTS_ROOT   — mirrored-creator shorts (main/ and 18plus/ channels)
├── books/        # BOOKS_ROOT    — shared bookshelf (EPUB/PDF/CBZ)
├── appstore/     # APPSTORE_ROOT — App Store catalog + APK archive
├── instagram/    # IG_COOKIES_ROOT — Instagram cookies.txt (see COOKIES.md)
└── tiktok/       # TIKTOK_COOKIES_ROOT — optional TikTok cookies.txt
```

The SQLite database lives in a named volume mounted at `/app/data`
(`DATA_DIR`), not in the tree above.

## 4. The compose stack

Make a compose directory (e.g. `compose/elitev2/`) holding a
`docker-compose.yml` and an `.env`. Here is a complete, ready-to-edit
`docker-compose.yml` — adjust the build `context`, the `/mnt/data/...` host
paths, and the `Host(...)` domain to yours:

```yaml
services:
  elitev2:
    build:
      context: /path/to/elite-v2      # the cloned repo
      dockerfile: Dockerfile
    container_name: elitev2
    restart: unless-stopped
    networks:
      - traefik                       # same external network Traefik runs on
    env_file: .env                    # everything from section "Minimum .env"
    environment:
      - NODE_ENV=production
      - PORT=3000                     # internal port Traefik forwards to
      - HOSTNAME=0.0.0.0
      # Storage roots → the bind mounts below
      - PROFILE_ROOT=/profile-store
      - IMPORT_ROOT=/import-store
      - POSTS_ROOT=/posts-store
      - SHORTS_ROOT=/shorts-store
      - BOOKS_ROOT=/books-store
      - APPSTORE_ROOT=/appstore-store
      - IG_COOKIES_ROOT=/instagram-store
      - IG_COOKIES_PATH=/instagram-store/cookies.txt
      - TIKTOK_COOKIES_ROOT=/tiktok-store
      - TIKTOK_COOKIES_PATH=/tiktok-store/cookies.txt
      # Optional: point the shorts "Grab" button at grabbit (section 5)
      - GRABBIT_URL=http://grabbit:3000
      - GRABBIT_INTERNAL_TOKEN=${GRABBIT_INTERNAL_TOKEN}
    volumes:
      - elitev2_data:/app/data        # SQLite DB (named volume)
      - /mnt/data/elitev2/profile:/profile-store
      - /mnt/data/elitev2/import:/import-store
      - /mnt/data/elitev2/posts:/posts-store
      - /mnt/data/elitev2/shorts:/shorts-store
      - /mnt/data/elitev2/books:/books-store
      - /mnt/data/elitev2/appstore:/appstore-store
      - /mnt/data/elitev2/instagram:/instagram-store
      - /mnt/data/elitev2/tiktok:/tiktok-store
      # Optional: Docker dashboard widget (also needs group_add below)
      # - /var/run/docker.sock:/var/run/docker.sock:ro
    # Optional: host 'docker' group GID so the non-root app user can read the
    # socket above. Find it with: getent group docker
    # group_add:
    #   - "999"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.elitev2-secure.rule=Host(`elitev2.example.com`)"
      - "traefik.http.routers.elitev2-secure.entrypoints=https"
      - "traefik.http.routers.elitev2-secure.tls=true"
      - "traefik.http.routers.elitev2-secure.tls.certresolver=cloudflare"
      - "traefik.http.services.elitev2-service.loadbalancer.server.port=3000"

volumes:
  elitev2_data:

networks:
  traefik:
    external: true                    # created/owned by the Traefik stack
```

The container publishes **no ports** — Traefik reaches it over the shared
`traefik` network and routes by hostname. What each label does, and the
Traefik-side prerequisites (the `https` entrypoint and the `cloudflare` cert
resolver), are spelled out in the
[README's Deployment section](../README.md#putting-it-behind-traefik). If you
use a different proxy, drop the labels and expose `PORT` however that proxy
expects.

Minimum `.env` (full reference in the
[README's Configuration tables](../README.md#configuration)):

```bash
JWT_SECRET=<long random value>          # openssl rand -base64 32
ADMIN_EMAIL=you@example.com             # first admin, seeded on first start
ADMIN_PASSWORD=<pick one>
APP_URL=https://elitev2.example.com     # used in email/push links
IMPORT_CRON_SECRET=<random>             # openssl rand -hex 24 — gates the import
                                        # trigger + cleanup-job endpoints
# Recommended (push notifications) — generate a keypair with:
#   npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
# Recommended (email invites):
SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASS=... MAIL_FROM=...
```

> `JWT_SECRET` is the only variable the app truly cannot start without; every
> storage root falls back to a subfolder of `DATA_DIR` if unset. But without
> `IMPORT_CRON_SECRET` the import-trigger and cleanup jobs return 401, so set
> it now if you'll use the background jobs.

Then:

```bash
docker compose build && docker compose up -d
```

First start creates the schema and seeds the admin account. Log in, then
generate registration codes under **Admin** for everyone else (the app is
invite-only by design).

### Optional extras

The core app (auth, gallery, shorts, posts, messaging, books, admin) runs with
just the above. These add peripheral features and are **off unless you wire
them**:

| Feature | What to add |
| ------- | ----------- |
| **Docker widget** on the dashboard | Mount the host socket read-only (`- /var/run/docker.sock:/var/run/docker.sock:ro`) **and** add the host `docker` group's GID under `group_add:` so the non-root app user can read it (`getent group docker` → the number). Without this the widget shows an error; nothing else breaks. |
| **Weather widget** location | `WEATHER_PLACE`, `WEATHER_LAT`, `WEATHER_LON` (defaults to a built-in city otherwise). Data via Open-Meteo, no key needed. |
| **Content-owner accounts** | `PUBLIC_EMAIL`/`PUBLIC_PASSWORD` and `ADULTS_EMAIL`/`ADULTS_PASSWORD` seed two maintenance accounts for the non-adult / adult content buckets (used by admin "act-as"). |
| **App Store auto-update** | `APP_UPDATE_SECRET` (for the host update-checker script), `GITHUB_TOKEN` (raises the GitHub API rate limit), `FDROID_REPO_URL`. |
| **Fresh yt-dlp / curl-impersonate** | The image ships yt-dlp, but sites change fast; bind-mount a current binary over `/usr/local/bin/yt-dlp` (and point `YT_DLP_BIN`/`CURL_IMPERSONATE_BIN` at your own) to avoid rebuilding for every yt-dlp bump. |
| **Legacy central gallery** | `GALLERY_ROOT` is only a read fallback for pre-per-user media — a fresh install doesn't need it. |

## 5. Optional: the grabbit media grabber

[grabbit](https://github.com/tjelite1986/grabbit) adds a "Grab from web" tab
to the shorts section: paste a video/profile URL, clips land in the shorts
import folder and are ingested automatically.

1. Clone and run grabbit on the **same** `traefik` network, with the shorts
   root shared:

   ```yaml
   services:
     grabbit:
       build: { context: /path/to/grabbit }
       container_name: grabbit
       networks: [traefik]
       environment:
         - ELITE_ROOT=/elitev2-shorts
         - GRABBIT_PASSWORD=${GRABBIT_PASSWORD}         # gates its own web UI
         - GRABBIT_INTERNAL_TOKEN=${GRABBIT_INTERNAL_TOKEN}
       volumes:
         - /mnt/data/elitev2/shorts:/elitev2-shorts
   ```

2. Elite v2 is already pointed at it — the `GRABBIT_URL` and
   `GRABBIT_INTERNAL_TOKEN` lines are in the compose from section 4. You only
   need to set the token value: generate one with `openssl rand -hex 24` and
   put the **same** `GRABBIT_INTERNAL_TOKEN=...` in **both** `.env` files. The
   token authenticates Elite v2's container-to-container calls; without it, any
   container on the shared network could use grabbit unauthenticated.

   (If you skip grabbit entirely, just delete the two `GRABBIT_*` lines from
   the section-4 compose — the Grab tab simply won't appear.)

3. `docker compose up -d` both stacks. The Grab tab appears for admins under
   **Shorts**; grabbed clips are picked up by the shorts import job.

## 6. Background jobs

The import/poll/transcode/cleanup pipeline does not run by itself — enable it
one of two ways (never both for the same job):

- **In-app (recommended):** log in as admin → **Admin → Background jobs** —
  enable each job and set its interval. Runs inside the production server;
  survives restarts. Details in the
  [README](../README.md#background-jobs-optional--only-for-a-real-server).
- **systemd timers:** unit files in `deploy/systemd/` and `scripts/systemd/`;
  they `docker exec` into the container on a schedule. You must edit paths,
  container name and user in each unit first.

One job is systemd-only: `elitev2-user-import` (the per-user drop-folder
import needs to fix file ownership on the host before importing). Install it
from `deploy/systemd/` if you use the drop folders — or trigger runs manually
from **Admin → Per-user folder import**.

What each underlying script does is catalogued in [SCRIPTS.md](SCRIPTS.md).

## 7. Getting media in

- **Your own files:** drop them in the per-user tree under `IMPORT_ROOT` —
  folder layout and the `[h_tag][f_collection][id_n]` filename grammar are
  documented in the
  [README](../README.md#importing-your-own-media-drop-folders).
- **Instagram / TikTok sync:** connect a source on a profile, install the
  cookies per [COOKIES.md](COOKIES.md), and enable the sync jobs.
- **Grab from web:** see grabbit above.
- **Books:** drop EPUB/PDF/CBZ into `IMPORT_ROOT/u_<user>/books/` (they land
  in the shared library) or upload in the UI.

## 8. First-run checklist

1. `https://<your-domain>` loads and the seeded admin can log in.
2. **Admin → Registration codes** — create codes / approve invite requests.
3. **Settings → 18+ access** — set a personal PIN if you use the 18+ sections.
4. **Admin → Permissions** — grant non-admin users access to any settings
   sections they should manage.
5. **Admin → Background jobs** — enable the jobs you need (start with shorts
   import, posts import, transcode, stories cleanup).
6. Upload one photo, one clip and one book to confirm the storage mounts are
   writable.
7. If using grabbit: paste a URL in **Shorts → Grab** and watch it land.

## 9. Troubleshooting

The [README's Troubleshooting section](../README.md#troubleshooting) covers
the common failures (native modules, Traefik 502s, permission-denied mounts,
login throttling). For job issues, each job row in **Admin → Background
jobs** shows its last result; systemd units log to
`journalctl -u <unit>`.
