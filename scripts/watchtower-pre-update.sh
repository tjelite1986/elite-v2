#!/bin/sh
# Watchtower pre-update hook — hold off an automatic update mid-transcode.
#
# Watchtower stops the container the moment a new :latest digest appears, and the
# shorts transcoder runs inside this container: a killed pass leaves nothing
# reusable, so the clip is encoded again from the start. Exiting 75 (EX_TEMPFAIL)
# makes Watchtower skip this cycle and try again on the next poll, by which time
# the queue has usually drained.
#
# 75 is the only non-zero code Watchtower acts on. Every other non-zero exit is
# logged and the container is replaced regardless, so there is no value in
# reporting failure — a check that cannot see is deliberately made to exit 0
# here. Blocking forever on a broken check would stop the app from ever updating
# and do it silently, which is the worse of the two failures; scripts/deploy.sh
# fails closed instead because a human is watching that one.
#
# Read /proc rather than calling ps: the runtime image is node:20-slim plus a
# handful of media tools, and procps is not among them.
set -u

for comm in /proc/[0-9]*/comm; do
  [ -r "$comm" ] || continue
  if [ "$(cat "$comm" 2>/dev/null)" = "ffmpeg" ]; then
    echo "pre-update: ffmpeg is running — postponing the update."
    exit 75
  fi
done

exit 0
