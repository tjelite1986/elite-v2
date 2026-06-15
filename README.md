# Elite v2

A private, invite-only personal hub: a shared photo/video gallery, real-time
messaging, and account management behind a glassmorphic, macOS menu-bar style
interface.

![Elite v2 gallery](screenshots/Screenshot_20260615_203535_Chrome.jpg)

## Features

- **Invite-only auth** — registration requires an admin-generated code; sessions
  use signed JWT cookies (`jose`).
- **Gallery** — upload and browse photos and videos, with EXIF parsing
  (`exifr` / `exif-reader`), thumbnailing via `sharp`, and a map view
  (`leaflet`) for geotagged media.
- **Messaging** — real-time chat with presence (`last_seen`) over a WebSocket
  endpoint served alongside Next.js by a custom server.
- **Admin** — generate and manage registration codes, review invite requests.
- **Account** — profile, settings, password change, and account deletion.

## Tech stack

- **Next.js 14** (App Router) + **React 18**, **TypeScript**
- **Tailwind CSS 3** + **shadcn**-style UI on **Ark UI** primitives
- **better-sqlite3** (SQLite, WAL mode) for storage
- **ws** for the WebSocket layer, run from a custom server (`server.mjs`)
- **nodemailer** for invite/notification email
- Packaged as a multi-stage **Docker** image

## Getting started

Requires Node.js 18.

```bash
npm install
npm run dev        # http://localhost:3020
```

### Scripts

| Script          | Description                                  |
| --------------- | -------------------------------------------- |
| `npm run dev`   | Start the dev server on port 3020            |
| `npm run build` | Production build                             |
| `npm start`     | Run the production custom server (`server.mjs`) |
| `npm run lint`  | Run ESLint                                    |

## Configuration

Configure via environment variables (e.g. an `.env` file — not committed):

| Variable                      | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| `JWT_SECRET`                  | **Required.** Secret used to sign session JWTs.      |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed the initial admin account on first run.       |
| `DATA_DIR`                    | Data directory (default: `./data`). Holds the SQLite DB. |
| `GALLERY_ROOT`                | Gallery storage root (default: `<DATA_DIR>/gallery`). |
| `IMPORT_DIR`                  | Directory scanned for bulk media import.             |
| `APP_URL`                     | Public base URL, used in outgoing email links.       |
| `MAIL_FROM`                   | "From" address for outgoing email.                   |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials for `nodemailer`. |
| `PORT` / `HOSTNAME`           | Bind address for the production server (default `0.0.0.0:3000`). |

> The app uses a custom server (`server.mjs`) rather than Next's `standalone`
> output, because the WebSocket endpoint (`/api/ws`) is hosted in the same
> process as Next.

## Deployment

Built and run as a Docker container behind a Traefik reverse proxy:

```bash
docker compose build
docker compose up -d
```

The SQLite database and uploaded media live in a persistent volume mounted at
`DATA_DIR`.

## Screenshots

| Messaging | Navigation | Account menu |
| --------- | ---------- | ------------ |
| ![Messaging](screenshots/Screenshot_20260615_203506_Chrome.jpg) | ![Navigation menu](screenshots/Screenshot_20260615_203435_Chrome.jpg) | ![Account menu](screenshots/Screenshot_20260615_203604_Chrome.jpg) |

## CI

GitHub Actions runs on every push and pull request to `main`:

- **Typecheck & build** — `tsc --noEmit` and `next build`.
- **npm audit** — fails the build on `critical` vulnerabilities; `high` and
  `moderate` are reported but non-blocking.

Dependency updates are managed by Dependabot (npm and GitHub Actions, weekly).
