#!/usr/bin/env python3
# Instagram profile-info + existence engine for elite-v2, backed by Instaloader.
# Runs INSIDE the elitev2 container, invoked by lib/instagram.ts. Instaloader is
# Instagram-specialized and self-paces (its RateController sleeps to stay under
# the limits a raw web_profile_info loop trips). We load the session from a
# Netscape cookies.txt (handling the #HttpOnly_ prefix the stdlib jar drops).
#
# Multi-cookie pool: scans IG_COOKIES_ROOT (default /instagram-store) for the
# root cookies.txt (id "default") plus one cookies.txt per immediate subfolder
# (id = subfolder name), so several IG accounts can be rotated. Login state is
# cached per cookie id; a blocked/expired account is "cooled down" in a JSON file
# shared with scripts/instagram-sync.mjs so both skip it for a while.
#
# Modes:
#   login-check          -> {"username": "<user>"|"", "id": "<cookie id>"}  (first working)
#   pool-status          -> [{"id","alive","username","cooling","cooling_until"}, ...]
#   user <username>      -> one JSON object (see profile_json); picks one working cookie
#   batch                -> usernames on stdin, one JSON line each (ONE cookie/loader
#                           so the RateController paces across them)

import json
import os
import re
import sys
import time

try:
    import instaloader
    from instaloader import Profile
    from instaloader.exceptions import ProfileNotExistsException
except Exception as e:  # instaloader missing / import error
    print(json.dumps({"error": "instaloader import failed: %s" % e}))
    sys.exit(0)

COOKIES_ROOT = os.environ.get("IG_COOKIES_ROOT", "/instagram-store")
# Legacy single cookie file (the root cookies.txt). Kept as a pool member.
LEGACY_COOKIES = os.environ.get(
    "IG_COOKIES_PATH", os.path.join(COOKIES_ROOT, "cookies.txt")
)
TMPDIR = os.environ.get("TMPDIR", "/tmp")
COOLDOWN_FILE = os.path.join(TMPDIR, "elitev2-ig-cooldowns.json")
COOLDOWN_MS = int(os.environ.get("IG_COOLDOWN_MINUTES", "60")) * 60 * 1000

POS_TTL = 1800  # 30 min: a confirmed-logged-in username is good for a while
NEG_TTL = 300   # 5 min: matches IG's "wait a few minutes" backoff

_ID_STRIP = re.compile(r"[^a-z0-9._-]")
_SUBDIR_OK = re.compile(r"^[A-Za-z0-9._-]+$")


def sanitize_id(name):
    s = _ID_STRIP.sub("", str(name or "").lower())
    return s or "default"


def list_cookie_pool():
    """[(id, path)] for the root cookies.txt (id 'default') + one per immediate
    subfolder (id = folder name). Sorted by id, deduped by realpath."""
    members = []
    seen = set()

    def add(cid, path):
        if not path or not os.path.isfile(path):
            return
        try:
            rp = os.path.realpath(path)
        except Exception:
            rp = path
        if rp in seen:
            return
        seen.add(rp)
        members.append((cid, path))

    add("default", LEGACY_COOKIES)
    try:
        for name in sorted(os.listdir(COOKIES_ROOT)):
            if not _SUBDIR_OK.match(name):
                continue
            d = os.path.join(COOKIES_ROOT, name)
            if not os.path.isdir(d):
                continue
            pref = os.path.join(d, "cookies.txt")
            if os.path.isfile(pref):
                add(sanitize_id(name), pref)
            else:
                txts = sorted(f for f in os.listdir(d) if f.endswith(".txt"))
                if txts:
                    add(sanitize_id(name), os.path.join(d, txts[0]))
    except FileNotFoundError:
        pass
    members.sort(key=lambda m: m[0])
    return members


# --- Cooldown state (shared with instagram-sync.mjs) ----------------------

def read_cooldowns():
    try:
        with open(COOLDOWN_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def is_cooling(cid, now_ms=None):
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    e = read_cooldowns().get(cid)
    try:
        return bool(e) and float(e.get("until", 0)) > now_ms
    except Exception:
        return False


def mark_cooling(cid, reason):
    try:
        d = read_cooldowns()
        d[cid] = {"until": time.time() * 1000 + COOLDOWN_MS, "reason": str(reason)[:200]}
        tmp = COOLDOWN_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, COOLDOWN_FILE)
    except Exception:
        pass


# --- Per-cookie login-state cache -----------------------------------------
# test_login() hits graphql/query, the exact endpoint Instagram throttles
# hardest ("Please wait a few minutes"). We probe at most once per TTL per cookie
# and reuse the result so a burst of fetches or admin-page polls can't trip it.

def _login_cache_path(cid):
    return os.path.join(TMPDIR, "elitev2-ig-login-%s.json" % sanitize_id(cid))


def _read_login_cache(cid):
    try:
        with open(_login_cache_path(cid), encoding="utf-8") as f:
            d = json.load(f)
        age = time.time() - float(d.get("ts", 0))
        ttl = POS_TTL if d.get("username") else NEG_TTL
        if age < ttl:
            return d.get("username") or ""
    except Exception:
        pass
    return None  # no fresh entry -> caller must probe


def _write_login_cache(cid, username):
    try:
        tmp = _login_cache_path(cid) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"username": username or "", "ts": time.time()}, f)
        os.replace(tmp, _login_cache_path(cid))
    except Exception:
        pass


def resolve_login(L, cid, force=False):
    """Logged-in username for this cookie, cached per id. Probes test_login() at
    most once per TTL. A failed probe cools the cookie down so the pool skips it."""
    if not force:
        cached = _read_login_cache(cid)
        if cached is not None:
            return cached
    try:
        u = L.test_login() or ""
    except Exception:
        u = ""
    _write_login_cache(cid, u)
    if not u:
        mark_cooling(cid, "login probe failed / throttled")
    return u


def make_loader(cookie_path):
    L = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        # Cap retries at 2 (instaloader defaults to 3) so a throttled request
        # doesn't become three graphql hits digging the rate-limit hole deeper.
        max_connection_attempts=2,
    )
    sess = L.context._session
    try:
        with open(cookie_path, encoding="utf-8") as f:
            for line in f:
                t = line
                if t.startswith("#HttpOnly_"):
                    t = t[len("#HttpOnly_"):]
                t = t.rstrip("\n")
                if not t or t.startswith("#"):
                    continue
                parts = t.split("\t")
                if len(parts) < 7:
                    continue
                domain, _flag, _path, _secure, _exp, name, value = parts[:7]
                if "instagram.com" not in domain:
                    continue
                sess.cookies.set(name, value, domain=domain)
    except (FileNotFoundError, TypeError):
        pass
    return L


def pick_working_cookie(force=False):
    """(id, path, loader, username) for the first pool member that logs in. Tries
    non-cooling members first; falls back to a cooling one only if none work.
    Returns the first attempt (empty username) when nobody logs in, or a cookie-
    less loader when the pool is empty."""
    pool = list_cookie_pool()
    if not pool:
        return (None, None, make_loader(None), "")
    now = time.time() * 1000
    order = [m for m in pool if not is_cooling(m[0], now)] + [
        m for m in pool if is_cooling(m[0], now)
    ]
    first = None
    for cid, path in order:
        L = make_loader(path)
        u = resolve_login(L, cid, force=force)
        if first is None:
            first = (cid, path, L, u)
        if u:
            try:
                L.context.username = u
            except Exception:
                pass
            return (cid, path, L, u)
    return first


def profile_json(L, username):
    try:
        p = Profile.from_username(L.context, username)
    except ProfileNotExistsException:
        return {"username": username, "exists": False}
    except Exception as e:
        return {"username": username, "error": "%s: %s" % (type(e).__name__, str(e)[:200])}

    links = []
    try:
        for l in (p._metadata("bio_links") or []):
            if isinstance(l, dict) and l.get("url"):
                links.append(l["url"])
    except Exception:
        pass
    try:
        if p.external_url:
            links.append(p.external_url)
    except Exception:
        pass

    return {
        "username": p.username,
        "exists": True,
        "full_name": p.full_name,
        "biography": p.biography,
        "profile_pic_url": p.profile_pic_url,
        "followers": p.followers,
        "mediacount": p.mediacount,
        "links": links,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no mode"}))
        return
    mode = sys.argv[1]

    if mode == "login-check":
        # Explicit admin re-validation: bypass the per-cookie cache and probe.
        cid, _path, _L, u = pick_working_cookie(force=True)
        print(json.dumps({"username": u, "id": cid or ""}))
        return

    if mode == "pool-status":
        now = time.time() * 1000
        out = []
        for cid, path in list_cookie_pool():
            if is_cooling(cid, now):
                e = read_cooldowns().get(cid, {}) or {}
                out.append({
                    "id": cid, "alive": False, "username": "",
                    "cooling": True, "cooling_until": e.get("until"),
                })
                continue
            L = make_loader(path)
            u = resolve_login(L, cid, force=False)  # cached -> won't hammer graphql
            # resolve_login may have just cooled this cookie down on a failed probe.
            e = read_cooldowns().get(cid, {}) or {}
            cool = is_cooling(cid, now)
            out.append({
                "id": cid, "alive": bool(u), "username": u or "",
                "cooling": cool, "cooling_until": e.get("until") if cool else None,
            })
        print(json.dumps(out))
        return

    # user / batch: one cookie + one loader for the whole call.
    _cid, _path, L, _u = pick_working_cookie(force=False)
    if mode == "user":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "no username"}))
            return
        print(json.dumps(profile_json(L, sys.argv[2])))
    elif mode == "batch":
        for line in sys.stdin:
            name = line.strip()
            if not name:
                continue
            print(json.dumps(profile_json(L, name)), flush=True)
    else:
        print(json.dumps({"error": "unknown mode"}))


if __name__ == "__main__":
    main()
