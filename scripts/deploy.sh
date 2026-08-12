#!/usr/bin/env bash
# deploy.sh — deploy the pushed HEAD commit to the Pi, deterministically.
#
# The image for a commit only exists once CI has published it, and the obvious
# manual sequence lies in both directions: `gh run list --limit 1` can resolve a
# previous run, and a `compose pull` that lands before the publish job has
# finished fetches the PREVIOUS `latest` digest — after which `up -d` no-ops and
# prints "Running", which reads exactly like a successful deploy.
#
# So this script keys off the HEAD sha throughout: it finds that commit's CI run,
# polls it to a terminal state, requires the publish job itself to have
# succeeded, and then refuses to finish unless the image now running is the one
# tagged sha-<HEAD>. Every check compares against the commit, never against
# "whatever is newest".
#
# Usage: scripts/deploy.sh          # deploy current HEAD
#        FORCE=1 scripts/deploy.sh  # recreate even while a transcode is running
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-/home/thomas/docker2/compose/elitev2}"
CONTAINER="${CONTAINER:-elitev2}"
IMAGE="${IMAGE:-ghcr.io/tjelite1986/elite-v2}"
POLL_SECS="${POLL_SECS:-20}"

cd "$REPO_DIR"
SHA="$(git rev-parse HEAD)"
# Must match docker/metadata-action's type=sha tag, which is 7 characters.
SHORT="$(git rev-parse --short=7 HEAD)"
echo "Deploying $SHORT ($(git log -1 --format=%s))"

if ! git branch -r --contains "$SHA" 2>/dev/null | grep -q .; then
  echo "ERROR: HEAD ($SHORT) is not on any remote branch — push first." >&2
  exit 1
fi

# Find the CI run for THIS sha. Scan recent runs rather than taking the newest,
# and keep looking for a while: a run needs a moment to register after a push.
echo "Locating CI run for $SHORT ..."
RID=""
for _ in $(seq 1 15); do
  RID="$(gh run list --limit 20 --json databaseId,headSha \
        -q "[.[] | select(.headSha == \"$SHA\")][0].databaseId" 2>/dev/null || true)"
  [ -n "$RID" ] && [ "$RID" != "null" ] && break
  sleep 5
done
if [ -z "$RID" ] || [ "$RID" = "null" ]; then
  echo "ERROR: no CI run found for $SHA after waiting." >&2
  exit 1
fi
echo "CI run: $RID — polling to completion ..."

while true; do
  ST="$(gh run view "$RID" --json status,conclusion \
        -q '.status+" "+(.conclusion // "")' 2>/dev/null || true)"
  case "$ST" in
    "completed "*) break ;;
  esac
  printf '  %s\r' "$ST"
  sleep "$POLL_SECS"
done
echo "CI final: $ST"
[ "${ST#* }" = "success" ] || {
  echo "ERROR: CI did not succeed (${ST#* }); not deploying." >&2
  exit 1
}

# A green run is not the same thing as a published image: the publish job is
# skipped on pull_request runs, and a skipped job leaves the whole run "success".
PUB="$(gh run view "$RID" --json jobs \
      -q '[.jobs[] | select(.name == "Build & push image")][0].conclusion // "missing"')"
[ "$PUB" = "success" ] || {
  echo "ERROR: the publish job did not succeed (state: $PUB) — no image for $SHORT." >&2
  exit 1
}

# The host docker daemon — never a remote one inherited from the environment.
unset DOCKER_HOST

# Recreating kills whatever ffmpeg is mid-file: the shorts transcoder runs inside
# this container via docker exec, and a half-written output is discarded, so the
# clip has to be transcoded again from the start.
#
# Read the process list from the host with `docker top`, not with `ps` inside the
# container: node:20-slim need not ship procps, and a missing ps would report an
# empty process list — a guard that answers "idle" when it cannot see is worse
# than no guard.
if [ "${FORCE:-0}" != "1" ]; then
  TOP="$(docker top "$CONTAINER" -o pid,args 2>/dev/null || true)"
  if [ -z "$TOP" ]; then
    echo "WARNING: could not read $CONTAINER's process list; transcode check skipped." >&2
  else
    BUSY="$(printf '%s\n' "$TOP" | grep -c ffmpeg || true)"
    if [ "$BUSY" -gt 0 ]; then
      echo "ERROR: $BUSY ffmpeg process(es) running — a restart would discard that work." >&2
      echo "       Wait for the queue to drain, or re-run with FORCE=1." >&2
      exit 1
    fi
  fi
fi

PREV="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"
echo "Pulling + recreating from $COMPOSE_DIR ..."
( cd "$COMPOSE_DIR" && docker compose pull && docker compose up -d )

# Confirm what is running is this commit's image, not a stale `latest` that
# happened to pull cleanly. Both tags point at one digest, so pulling the sha tag
# after `latest` only names an image that is already on disk.
docker pull -q "$IMAGE:sha-$SHORT" >/dev/null
WANT="$(docker image inspect "$IMAGE:sha-$SHORT" --format '{{.Id}}')"
NEW="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo none)"

echo "prev image: $PREV"
echo "new  image: $NEW"
if [ "$NEW" != "$WANT" ]; then
  echo "ERROR: the container is not running $SHORT's image (expected $WANT)." >&2
  echo "       A local build of the same tag can shadow the registry copy; see" >&2
  echo "       the pull-never note in $COMPOSE_DIR/docker-compose.yml." >&2
  exit 1
fi
[ "$PREV" = "$NEW" ] && echo "NOTE: image unchanged — $SHORT was already deployed."

# Anchored: an unanchored name filter is a substring match, and it reports the
# elitev2-test sandbox's uptime alongside this container's.
docker ps --filter "name=^${CONTAINER}$" --format 'status: {{.Status}}'
echo "OK: $CONTAINER is running $SHORT."
echo "Tip: after a UI change, hard-refresh to get past the service worker's cached bundle."
