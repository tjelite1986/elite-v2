#!/usr/bin/env python3
# Instagram profile-info + existence engine for elite-v2, backed by Instaloader.
# Runs INSIDE the elitev2 container, invoked by lib/instagram.ts. Instaloader is
# Instagram-specialized and self-paces (its RateController sleeps to stay under
# the limits that a raw web_profile_info loop trips). We load the session from
# the Netscape cookies.txt (handling the #HttpOnly_ prefix the stdlib jar drops).
#
# Modes:
#   login-check          -> {"username": "<logged-in user>" | ""}
#   user <username>      -> one JSON object (see profile_json)
#   batch                -> read usernames on stdin, print one JSON line each
#                           (one process so the RateController paces across them)

import json
import os
import sys
import time

try:
    import instaloader
    from instaloader import Profile
    from instaloader.exceptions import ProfileNotExistsException
except Exception as e:  # instaloader missing / import error
    print(json.dumps({"error": "instaloader import failed: %s" % e}))
    sys.exit(0)

COOKIES = os.environ.get("IG_COOKIES_PATH", "/instagram-store/cookies.txt")

# Shared login-state cache. test_login() hits graphql/query, the exact endpoint
# Instagram throttles hardest ("Please wait a few minutes"). Without a cache,
# EVERY invocation (login-check, user, batch) burned one of those calls, so a
# burst of profile fetches or admin-page polls tripped the rate limit. We probe
# at most once per POS_TTL and reuse the result; a negative/unknown result is
# cached only briefly so a transient 401 clears on its own.
LOGIN_CACHE = os.path.join(
    os.environ.get("TMPDIR", "/tmp"), "elitev2-ig-login.json"
)
POS_TTL = 1800  # 30 min: a confirmed-logged-in username is good for a while
NEG_TTL = 300   # 5 min: matches IG's "wait a few minutes" backoff


def _read_login_cache():
    try:
        with open(LOGIN_CACHE, encoding="utf-8") as f:
            d = json.load(f)
        age = time.time() - float(d.get("ts", 0))
        ttl = POS_TTL if d.get("username") else NEG_TTL
        if age < ttl:
            return d.get("username") or ""
    except Exception:
        pass
    return None  # no fresh entry -> caller must probe


def _write_login_cache(username):
    try:
        tmp = LOGIN_CACHE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"username": username or "", "ts": time.time()}, f)
        os.replace(tmp, LOGIN_CACHE)
    except Exception:
        pass


def resolve_login(L, force=False):
    """Logged-in username for this session, cached. Probes test_login() at most
    once per TTL across all invocations. `force` bypasses the cache (used by the
    explicit login-check mode so an admin can re-validate on demand)."""
    if not force:
        cached = _read_login_cache()
        if cached is not None:
            return cached
    try:
        u = L.test_login() or ""
    except Exception:
        u = ""
    _write_login_cache(u)
    return u


def make_loader():
    L = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        # Cap retries at 2 (instaloader defaults to 3). A throttled request
        # otherwise becomes three graphql hits, digging the rate-limit hole
        # deeper; one paced retry (its RateController sleeps between attempts)
        # is enough to ride out a transient hiccup without hammering.
        max_connection_attempts=2,
    )
    sess = L.context._session
    try:
        with open(COOKIES, encoding="utf-8") as f:
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
    except FileNotFoundError:
        pass
    # Mark the context logged-in if the session is valid (enables the private
    # endpoints + better rate handling). Uses the cached login state so a fetch
    # doesn't fire a fresh graphql test_login every time.
    try:
        u = resolve_login(L)
        if u:
            L.context.username = u
    except Exception:
        pass
    return L


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
        L = make_loader()
        # Explicit admin re-validation: bypass the cache and probe once, then
        # refresh the shared cache so subsequent fetches reuse the result.
        u = resolve_login(L, force=True)
        print(json.dumps({"username": u}))
        return

    L = make_loader()
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
