# Cookies guide (Instagram / TikTok sync)

The Instagram and TikTok sync features log in to those sites as *you* by
loading an exported `cookies.txt`. This guide covers what format the file
must be in, how to export it (desktop and Android), where to put it, and how
to keep it working.

| Service | Cookies | Why |
| ------- | ------- | --- |
| **Instagram** | **Required** | Instagram blocks anonymous profile reads almost immediately. |
| **TikTok** | **Optional** | Public profiles download anonymously; a cookie only helps for age-gated or rate-limited content. |

## 1. The format: Netscape `cookies.txt`

Both syncs expect the classic **Netscape / Mozilla `cookies.txt`** format — a
tab-separated text file, one cookie per line, starting with
`# Netscape HTTP Cookie File`. This is the same format `yt-dlp` and
`gallery-dl` use. JSON cookie exports do **not** work; you need a
`cookies.txt` exporter specifically.

> The Instagram loader (Instaloader, via `scripts/ig_profile.py`) correctly
> handles the `#HttpOnly_` line prefix that some exporters add, so leave those
> lines as-is — don't strip them.

## 2. Exporting on desktop (easiest)

1. Log in to Instagram (or TikTok) in a desktop browser as the account you
   want the sync to use. A secondary/burner account is wise — see the safety
   note below.
2. Install a cookies.txt exporter extension, e.g. **"Get cookies.txt LOCALLY"**
   (available for Chrome and Firefox; the "LOCALLY" one keeps everything
   on-device).
3. With the Instagram tab open, click the extension and **Export** →
   save/rename the file to `cookies.txt`.

## 3. Exporting on Android (phone / tablet)

Regular mobile Chrome has no extensions, so use a Chromium build that does.
**[Ultimatum](https://github.com/gonzazoid/Ultimatum)** is a Chromium fork for
Android (ARM64) with desktop-style webextension support — it can run a
`cookies.txt` exporter just like desktop Chrome.

1. Install Ultimatum (see its repo — it's built from source / installed as an
   APK; it is not on the Play Store).
2. In Ultimatum, install a cookies exporter extension (e.g. **Get cookies.txt
   LOCALLY** from the Chrome/Opera store, or a Tampermonkey userscript).
3. Log in to Instagram in Ultimatum, run the extension, and export
   `cookies.txt`.
4. Move the file to the server (SFTP, Samba, or a `docker cp`).

> **Security caveat (from Ultimatum's own README):** it does not show a
> permission prompt when an extension requests elevated access, and many
> Chrome APIs are incomplete. Only install extensions you trust, prefer a
> local-only cookies exporter, and consider using a dedicated/burner Instagram
> account for the sync rather than your main login.

Alternatives if you'd rather not build Ultimatum: export on desktop (section
2), or use a rooted-device / ADB method to pull the browser's cookie DB — but
the desktop route is by far the simplest.

## 4. Where the file goes

The cookie roots are bind-mounted into the container (see
[SETUP.md](SETUP.md)). Place the files on the **host** side:

```
<IG_COOKIES_ROOT>/cookies.txt        e.g. /mnt/data/elitev2/instagram/cookies.txt
<TIKTOK_COOKIES_ROOT>/cookies.txt    e.g. /mnt/data/elitev2/tiktok/cookies.txt
```

Inside the container these resolve to `IG_COOKIES_PATH`
(`/instagram-store/cookies.txt`) and `TIKTOK_COOKIES_PATH`
(`/tiktok-store/cookies.txt`).

### Multiple Instagram accounts (cookie pool)

For Instagram you can rotate several accounts to spread the rate limit. The
loader scans `IG_COOKIES_ROOT` for:

- the root `cookies.txt` — pool id `default`, **and**
- one `cookies.txt` per immediate subfolder — pool id = the subfolder name.

```
/mnt/data/elitev2/instagram/
├── cookies.txt              # id "default"
├── acct-a/cookies.txt       # id "acct-a"
└── acct-b/cookies.txt       # id "acct-b"
```

A blocked or expired account is automatically "cooled down" for a while
(`IG_COOLDOWN_MINUTES`, default 60) and skipped; the others keep working.
Check the pool with the `pool-status` mode of `scripts/ig_profile.py`.

## 5. Verifying and refreshing

- **Verify:** trigger a sync (the profile's "Sync from Instagram / TikTok"
  button, or run the sync job once from **Admin → Background jobs**). The
  Instagram sync logs whether it found a working cookie; the TikTok sync logs
  `cookies: present` or `none (public download)`.
- **They expire:** Instagram sessions die periodically (logout, password
  change, or Instagram invalidating them). When syncs start failing with
  auth/login errors, re-export a fresh `cookies.txt` and replace the file —
  no restart needed, the next run picks it up.
- **Rate-limit knobs (Instagram):** `IG_SLEEP_REQUEST` (per-request delay
  range), `IG_PROFILE_SLEEP_SECONDS` (between profiles) and
  `IG_COOLDOWN_MINUTES` are set in the compose env; the loader also self-paces
  to stay under Instagram's limits.

## 6. Safety notes

- Automated access is against Instagram's ToS and can get an account
  restricted or banned — **use a secondary account**, not one you care about.
- `cookies.txt` is a full login credential. Keep the files readable only where
  they need to be, never commit them, and rotate/delete them when unused.
