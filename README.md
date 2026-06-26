# Elite v2

A private, invite-only personal hub: a shared photo/video gallery, short-video
and post feeds, a shared bookshelf, an in-app app store, real-time messaging,
and account management behind a glassmorphic, macOS menu-bar style interface.

![Elite v2 gallery](screenshots/Screenshot_20260615_203535_Chrome.jpg)

## Features

- **Invite-only auth** — registration requires an admin-generated code (or an
  approved invite request); sessions use signed JWT cookies (`jose`) with a
  `jti` so they can be revoked server-side. Device/session list and remote
  sign-out live in Settings. DB-backed login throttling guards `/api/auth/login`.
- **Gallery** — upload and browse photos and videos with EXIF parsing
  (`exifr` / `exif-reader`), `sharp` thumbnails, tags, a map view (`leaflet`)
  for geotagged media, trash, and client-side smart collections
  (Videos / Places / Years). Per-user storage with album sharing via public
  links.
- **Shorts** — a TikTok-style vertical video feed with an immersive player,
  per-user public/private clips, playlists, and a PIN-gated 18+ section
  (`/shorts18`). Clips can be grabbed from external sources via the `ladda`
  backend, auto-polled, transcoded, and deduplicated.
- **Posts** — an Instagram-style feed with likes, comments, follows, stories,
  search, rich markdown composing (`react-markdown` + `remark-gfm`),
  `@mention` autocomplete, and link-preview cards.
- **People & profiles** — a unified `/people/<username>` directory; each profile
  has custom fields with per-field visibility, badges, an avatar with crop, and
  member stats.
- **Books** — a shared EPUB / PDF / CBZ reader (`epubjs`, `pdfjs-dist`,
  `jszip`) with per-user reading progress.
- **App Store** — an in-app `/store` catalog of installable "apps" plus an APK
  archive that imports from GitHub / F-Droid / Play, auto-updates, and verifies
  APK signatures (trust-on-first-use). Adult apps are PIN-gated.
- **Messaging** — real-time direct messages and group channels with presence
  (`last_seen`), reactions, replies, edits, and soft-delete, over a WebSocket
  endpoint served alongside Next.js by a custom server.
- **Instagram sync** — profile-driven, cookie-based import that routes photos to
  posts and videos to shorts (`gallery-dl`).
- **PWA & Web Push** — installable progressive web app (manifest, service
  worker, icons) with `web-push` (VAPID) notifications.
- **Appearance** — per-user accent color and dark background themes, applied
  without a flash on load.
- **Admin** — generate and manage registration codes, review invite requests,
  manage the store catalog, and content-owner "act-as" impersonation.
- **Account** — profile, settings, password change, and account deletion.

## Tech stack

- **Next.js 14** (App Router) + **React 18**, **TypeScript**
- **Tailwind CSS 3** + **shadcn**-style UI on **Ark UI** primitives
- **better-sqlite3** (SQLite, WAL mode) for storage; **Kysely** builds queries,
  `better-sqlite3` executes them synchronously
- **ws** for the WebSocket layer, run from a custom server (`server.mjs`)
- **nodemailer** for invite/notification email
- **web-push** for push notifications
- `sharp`, `exifr` / `exif-reader`, `leaflet`, `epubjs`, `pdfjs-dist`,
  `react-markdown`
- Packaged as a multi-stage **Docker** image, run behind **Traefik**

## Getting started

This walks you through running the app on your own computer, step by step. No
prior experience needed — just follow each step in order.

**Before you start**, install these two free tools (skip any you already have):

- **Node.js 18** — the runtime that runs the app. Download it from
  [nodejs.org](https://nodejs.org) and pick version 18. To check if you already
  have it, run `node --version` in a terminal; it should print `v18.something`.
- **Git** — used to download the code. Get it from
  [git-scm.com](https://git-scm.com). Check with `git --version`.

Now open a terminal (Terminal on macOS/Linux, or "Git Bash" / PowerShell on
Windows) and run these commands one at a time:

**Step 1 — Download the code:**

```bash
git clone https://github.com/tjelite1986/elite-v2.git
cd elite-v2
```

This downloads the project into a folder called `elite-v2` and moves you into
it. Every command after this must be run from inside that folder.

**Step 2 — Install the dependencies:**

```bash
npm install
```

This downloads all the libraries the app needs. It can take a few minutes the
first time. You only need to do this again if the project's dependencies change.

**Step 3 — Create your settings file:**

The app needs a few secret settings to run. Create a file named `.env` in the
`elite-v2` folder with this content:

```bash
# Secret key used to sign your login sessions (see note below).
JWT_SECRET=paste-a-long-random-value-here

# The login for the first admin account, created automatically on first start.
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=pick-a-password
```

These three are the minimum needed to start. Every other setting (email,
storage folders, push notifications, etc.) is optional and listed under
[Configuration](#configuration) below.

> **What is `JWT_SECRET`?** It's the secret key the app uses to sign your login
> sessions. When you log in, the app gives your browser a signed token; on every
> request it checks that token was signed with this exact key. Anyone who knows
> the value could forge logins and impersonate any user — so keep it secret,
> never commit it, and make it long and random.
>
> You don't strictly need a command — any long string of letters and numbers
> works — but a made-up one is easier to guess, so generating a random value is
> strongly recommended:
>
> ```bash
> # With OpenSSL (available on macOS/Linux):
> openssl rand -base64 32
>
> # Or with Node (which you already installed):
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
>
> Run either one, copy the output, and paste it as the `JWT_SECRET` value.
> Note: if you change `JWT_SECRET` later, everyone's existing sessions become
> invalid and they'll have to log in again.

**Step 4 — Start the app:**

```bash
npm run dev
```

Wait until it says it's ready, then open **http://localhost:3020** in your web
browser. Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in step 3.

To stop the app, press `Ctrl + C` in the terminal. To start it again later, just
run `npm run dev` from the `elite-v2` folder (steps 1–3 are one-time setup).

> **Want to host it on a server for real (not just your own computer)?** Use the
> Docker + Traefik setup described under [Deployment](#deployment) instead.

### Commands you'll use

These are the everyday commands, run from inside the `elite-v2` folder:

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Start the app for local development (port 3020). |
| `npm run build` | Build the optimized production version.       |
| `npm start`     | Run the production server (`server.mjs`) after a build. |
| `npm run lint`  | Check the code for style/quality problems.    |

For just trying the app out, `npm run dev` is all you need.

### Background jobs (optional — only for a real server)

The project also ships helper scripts in the `scripts/` folder for things like
importing media, polling for new shorts, transcoding videos, cleaning up old
stories, and checking for app updates.

**These do NOT run on their own.** Nothing happens automatically just because
you started the app — the scripts only run when something triggers them. On the
production server they're triggered on a schedule by **systemd timers** (the
unit files in `deploy/systemd/` and `scripts/systemd/`). If you skip this, the
app still works fully; you just won't get the automatic background imports and
maintenance.

**If you don't need them:** ignore this section. You can run any script by hand
whenever you want instead, e.g. `node scripts/transcode-shorts.mjs`.

**If you do want them to run automatically**, you have to install and enable the
timers yourself — they are not set up for you. On a Linux host:

```bash
# Copy the timer + service files to systemd, then enable them.
sudo cp deploy/systemd/elitev2-*.{service,timer} /etc/systemd/system/
sudo cp scripts/systemd/elitev2-*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now elitev2-shorts-import.timer   # repeat per timer you want
```

**Important — you almost certainly need to edit the unit files first.** They
were written for this specific machine and contain hard-coded values that won't
match your setup:

- **Folder paths** — e.g. `/mnt/4tb/elitev2/profile` and
  `/home/thomas/code/elite-v2`. Change these to wherever *your* storage folders
  and project live.
- **Container name** — most services run a command inside the Docker container
  named `elitev2` (`docker exec elitev2 ...`). If your container has a different
  name, update it.
- **User/Group** — they run as `User=thomas` / `Group=thomas`. Change to your
  own username.
- **Secrets** — e.g. `APP_UPDATE_SECRET`. Set these to match your `.env`.

Open each `.service` file, adjust those lines, then run the
`daemon-reload` + `enable --now` commands above. Check that a timer is active
with `systemctl list-timers | grep elitev2`, and view a job's output with
`journalctl -u elitev2-shorts-import.service`.

## Configuration

Configure via environment variables (e.g. an `.env` file — not committed):

### Core

| Variable                      | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| `JWT_SECRET`                  | **Required.** Secret used to sign session JWTs.      |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed the initial admin account on first run.       |
| `DATA_DIR`                    | Data directory (default: `./data`). Holds the SQLite DB. |
| `APP_URL`                     | Public base URL, used in outgoing email/push links.  |
| `PORT` / `HOSTNAME`           | Bind address for the production server (default `0.0.0.0:3000`). |

### Storage roots

| Variable        | Description                                            |
| --------------- | ----------------------------------------------------- |
| `PROFILE_ROOT`  | Per-user content root (`u_<user>/…` for posts, shorts, gallery, imports). |
| `GALLERY_ROOT`  | Gallery storage root (default: `<DATA_DIR>/gallery`).  |
| `POSTS_ROOT`    | Posts media storage root.                              |
| `SHORTS_ROOT`   | Shorts media storage root.                             |
| `BOOKS_ROOT`    | Bookshelf storage root (EPUB / PDF / CBZ).             |
| `APPSTORE_ROOT` / `STORE_DIR` | App Store catalog / APK archive storage.|

### Email

| Variable        | Description                                            |
| --------------- | ----------------------------------------------------- |
| `MAIL_FROM`     | "From" address for outgoing email.                    |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials for `nodemailer`. |

### Web Push

| Variable          | Description                                          |
| ----------------- | --------------------------------------------------- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | VAPID keys for `web-push`. |

### Import / integrations

| Variable              | Description                                          |
| --------------------- | --------------------------------------------------- |
| `IMPORT_DIR` / `POSTS_IMPORT_DIR` / `SHORTS_IMPORT_DIR` | Directories scanned for bulk import. |
| `IMPORT_CRON_SECRET`  | Shared secret for import trigger endpoints.         |
| `LADDA_URL`           | URL of the `ladda` media-grabber backend (shorts "Grab"). |
| `IG_COOKIES_PATH` / `IG_SRC` | Instagram cookie file and source for sync.   |
| `GALLERY_DL_BIN` / `YT_DLP_BIN` / `CURL_IMPERSONATE_BIN` | Paths to external download tools. |
| `GITHUB_TOKEN` / `FDROID_REPO_URL` | App Store import sources.             |
| `APP_UPDATE_URL` / `APP_UPDATE_SOURCE` / `APP_UPDATE_SECRET` / `APP_UPDATE_PULL` | App auto-update wiring. |
| `ADULTS_EMAIL` / `PUBLIC_EMAIL` | Seeded content-owner accounts.            |

> The app uses a custom server (`server.mjs`) rather than Next's `standalone`
> output, because the WebSocket endpoint (`/api/ws`) is hosted in the same
> process as Next.

## Deployment

Built and run as a Docker container behind a [Traefik](https://traefik.io)
reverse proxy that terminates TLS (Let's Encrypt via the Cloudflare DNS
challenge).

```bash
docker compose build
docker compose up -d
```

> Operationally deployed from `docker2/compose/elitev2/` on the host (that dir
> holds the `.env` and the Traefik labels below). `--no-cache` is only needed
> when `package.json` changes.

The SQLite database and uploaded media live in a persistent volume mounted at
`DATA_DIR` (plus the dedicated storage roots above).

### Putting it behind Traefik

The container does **not** publish ports. Traefik discovers it over a shared
Docker network and routes by hostname, so both the app and Traefik must be on
the same external network (here named `traefik`):

```yaml
# docker-compose.yml (excerpt)
services:
  elitev2:
    build:
      context: /home/thomas/code/elite-v2
      dockerfile: Dockerfile
    container_name: elitev2
    restart: unless-stopped
    networks:
      - traefik           # same external network Traefik runs on
    environment:
      - NODE_ENV=production
      - PORT=3000         # internal port Traefik forwards to
      - HOSTNAME=0.0.0.0
      # ...app env vars (see Configuration) loaded from .env...
    volumes:
      - elitev2_data:/app/data
      # ...storage-root bind mounts...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.elitev2-secure.rule=Host(`elitev2.mecloud.win`)"
      - "traefik.http.routers.elitev2-secure.entrypoints=https"
      - "traefik.http.routers.elitev2-secure.tls=true"
      - "traefik.http.routers.elitev2-secure.tls.certresolver=cloudflare"
      - "traefik.http.services.elitev2-service.loadbalancer.server.port=3000"

volumes:
  elitev2_data:

networks:
  traefik:
    external: true        # created/owned by the Traefik stack
```

What each label does:

| Label | Purpose |
| ----- | ------- |
| `traefik.enable=true` | Opt this container in to Traefik routing. |
| `routers.elitev2-secure.rule=Host(...)` | Match requests for the public hostname. Point a DNS record at the host. |
| `routers.elitev2-secure.entrypoints=https` | Serve on the HTTPS entrypoint (`:443`). |
| `routers.elitev2-secure.tls=true` + `tls.certresolver=cloudflare` | Terminate TLS using the `cloudflare` ACME resolver defined in Traefik's static config. |
| `services.elitev2-service.loadbalancer.server.port=3000` | Forward to the container's internal port (`PORT`), since no ports are published. |

Prerequisites on the Traefik side (configured once, in Traefik's own static
config — not here):

- An `https` entrypoint on `:443` (with an `http` → `https` redirect on `:80`).
- A `cloudflare` `certResolver` using the Cloudflare DNS-01 challenge
  (Cloudflare API token + ACME email), so wildcard/subdomain certs for
  `*.mecloud.win` are issued automatically.
- The external `traefik` Docker network, which this stack joins.

When all of that is in place, `docker compose up -d` is enough — Traefik picks
up the new container via the Docker provider and starts routing
`https://elitev2.mecloud.win` to it.

## Troubleshooting

Common problems and how to fix them.

**`npm run dev` exits immediately or says `JWT_SECRET` is missing.**
The app needs the settings from step 3. Make sure there is a file named exactly
`.env` (not `.env.txt`) in the `elite-v2` folder, and that it contains at least
`JWT_SECRET`. Then run `npm run dev` again.

**"Port 3020 is already in use" (or the page won't load).**
Another program — often an old copy of this app — is using the port. Stop it
with `Ctrl + C` in the terminal where it's running, or start this one on a
different port: `npm run dev -- -p 3025`, then open `http://localhost:3025`.

**`npm install` fails while building `better-sqlite3` or `sharp`.**
These are native modules that compile on install. On Linux you need the build
tools first: `sudo apt-get install -y python3 make g++`. On macOS, install the
Xcode command line tools with `xcode-select --install`. Then run `npm install`
again.

**The app starts but uploading/processing images fails (`sharp` error).**
`sharp` needs the binary that matches your machine. Reinstall it fresh:
`npm rebuild sharp`, or remove `node_modules` and run `npm install` again.
(The lockfile here is generated on a Raspberry Pi / arm64, so on other platforms
`sharp`'s binary may need this rebuild — the CI workflow does the same thing.)

**I can't create a new account — registration is blocked.**
That's by design: Elite v2 is **invite-only**. The first admin account is
created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first start. Log in as that
admin and generate a registration code (or approve an invite request) for
anyone else.

**Login keeps failing even with the right password.**
After several failed attempts the login is temporarily throttled (a security
feature). Wait a few minutes and try again. If you genuinely forgot the admin
password, stop the app, set a new `ADMIN_PASSWORD` in `.env`, and restart — but
note the admin account is only seeded if it doesn't already exist, so for an
existing account you'll need to reset it in the database.

**Docker: the site shows "Bad Gateway" or a 404 from Traefik.**
Usually one of: the container isn't on the same external `traefik` network; the
`loadbalancer.server.port` label doesn't match the container's internal `PORT`
(both must be `3000`); or the `Host(...)` rule doesn't match the domain you're
visiting. Check `docker logs elitev2` and confirm the labels in
[Deployment](#deployment).

**Docker: `better-sqlite3` crashes with `ERR_DLOPEN_FAILED` at startup.**
The native module was built against a different Node version than the one in the
image. Rebuild the image without cache so it compiles against the right runtime:
`docker compose build --no-cache && docker compose up -d`.

**Docker: "permission denied" writing to a mounted storage folder.**
The container writes as a non-root user. Make sure the host folders mounted as
storage roots (gallery, posts, shorts, etc.) are writable — e.g.
`chmod -R 777 /path/to/storage` for a quick local fix.

## Screenshots

| Messaging | Navigation | Account menu |
| --------- | ---------- | ------------ |
| ![Messaging](screenshots/Screenshot_20260615_203506_Chrome.jpg) | ![Navigation menu](screenshots/Screenshot_20260615_203435_Chrome.jpg) | ![Account menu](screenshots/Screenshot_20260615_203604_Chrome.jpg) |

## CI

GitHub Actions runs on every push and pull request to `main`:

- **Typecheck & build** — `tsc --noEmit` and `next build`. Because the lockfile
  is generated on arm64 (Raspberry Pi), the workflow installs the linux-x64
  `sharp` binary explicitly before building.
- **npm audit** — fails the build on `critical` vulnerabilities; `high` and
  `moderate` are reported but non-blocking (the known Next.js 14.x DoS advisories
  have no fix without a major upgrade).

Dependency updates are managed by Dependabot (npm and GitHub Actions, weekly).
