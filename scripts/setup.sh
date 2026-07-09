#!/usr/bin/env bash
#
# Elite v2 setup wizard.
#
# An interactive, menu-driven installer that takes a fresh instance from nothing
# to a ready-to-`docker compose up` state:
#   - create the host storage folder tree
#   - generate a .env (auto-filled secrets + prompted values + optional placeholders)
#   - generate a matching docker-compose.yml (container-path env + host mounts + labels)
#   - generate a Traefik reverse-proxy stack (compose + static config + acme.json)
#   - generate a grabbit media-grabber stack wired to the shorts import folder
#   - generate the App Store update-check systemd timer (the only host-side job;
#     every other recurring script runs via the in-app Admin -> Background jobs)
#
# The .env holds only secrets and user values. Storage roots are container paths
# set in the compose `environment:` block; the host paths are the volume mounts.
# The wizard keeps both sides in sync from the same data root.
#
# Usage: ./setup.sh   (run it, then pick from the menu)
#
set -euo pipefail

# --- Session state (neutral placeholder defaults) --------------------------
DATA_ROOT="/srv/elitev2"
DOMAIN="elitev2.example.com"
ENV_OUT="./.env"
COMPOSE_OUT="./docker-compose.yml"
TRAEFIK_DIR="./traefik"
GRABBIT_DIR="./grabbit"
SYSTEMD_DIR="./systemd-units"

# Container mount targets, one per storage root (host <DATA_ROOT>/<key> maps here).
# key|container-path|env-var
STORAGE=(
  "profile|/profile-store|PROFILE_ROOT"
  "import|/import-store|IMPORT_ROOT"
  "posts|/posts-store|POSTS_ROOT"
  "shorts|/shorts-store|SHORTS_ROOT"
  "books|/books-store|BOOKS_ROOT"
  "appstore|/appstore-store|APPSTORE_ROOT"
  "appstore-downloads|/appstore-downloads|STORE_DIR"
  "instagram|/instagram-store|IG_COOKIES_ROOT"
  "tiktok|/tiktok-store|TIKTOK_COOKIES_ROOT"
)

# --- Small helpers ---------------------------------------------------------
say()  { printf '%s\n' "$*"; }
hr()   { printf '%s\n' "------------------------------------------------------------"; }
ask()  { local p="$1" d="${2:-}" a; if [[ -n "$d" ]]; then read -rp "$p [$d]: " a; printf '%s' "${a:-$d}"; else read -rp "$p: " a; printf '%s' "$a"; fi; }
ask_secret() { local p="$1" a; read -rsp "$p: " a; echo >&2; printf '%s' "$a"; }
yesno() { local p="$1" a; read -rp "$p [y/N]: " a; [[ "$a" == [yY] || "$a" == [yY][eE][sS] ]]; }

gen_secret_b64() { openssl rand -base64 32; }
gen_secret_hex() { openssl rand -hex 24; }

# Base64url (no padding) from stdin bytes. Strip newlines: base64 wraps at 76
# cols, which would split a 65-byte key across lines and corrupt the value.
b64url() { base64 | tr -d '\n' | tr '+/' '-_' | tr -d '='; }

# Generate a VAPID keypair. Echoes "PUBLIC PRIVATE"; empty strings if it can't.
gen_vapid() {
  local pub="" priv=""
  # Preferred: the web-push CLI (matches what the app expects exactly).
  if command -v npx >/dev/null 2>&1; then
    local out
    if out="$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)"; then
      pub="$(printf '%s' "$out"  | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
      priv="$(printf '%s' "$out" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
    fi
  fi
  # Fallback: derive a P-256 keypair with openssl.
  if [[ -z "$pub" || -z "$priv" ]] && command -v openssl >/dev/null 2>&1 && command -v xxd >/dev/null 2>&1; then
    local pem txt privhex pubhex
    pem="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null || true)"
    if [[ -n "$pem" ]]; then
      txt="$(printf '%s\n' "$pem" | openssl ec -text -noout 2>/dev/null || true)"
      # priv: 32-byte hex block; pub: 65-byte uncompressed point (04 || X || Y).
      privhex="$(printf '%s\n' "$txt" | awk '/priv:/{f=1;next} /pub:/{f=0} f' | tr -cd '0-9a-f')"
      pubhex="$( printf '%s\n' "$txt" | awk '/pub:/{f=1;next} /(ASN1 OID|NIST CURVE)/{f=0} f' | tr -cd '0-9a-f')"
      # Normalize private to exactly 32 bytes (openssl may prefix a leading 00).
      privhex="${privhex: -64}"
      if [[ ${#privhex} -eq 64 && ${#pubhex} -eq 130 ]]; then
        priv="$(printf '%s' "$privhex" | xxd -r -p | b64url)"
        pub="$( printf '%s' "$pubhex"  | xxd -r -p | b64url)"
      fi
    fi
  fi
  printf '%s %s\n' "$pub" "$priv"
}

# Refuse dangerous data roots.
valid_root() {
  local p="$1"
  [[ -n "$p" && "$p" == /* && "$p" != "/" ]]
}

# Parent of the app domain (elitev2.example.com -> example.com), used to default
# the wildcard cert and sibling-service hostnames.
base_domain() {
  local b="${DOMAIN#*.}"
  if [[ -z "$b" || "$b" == "$DOMAIN" || "$b" != *.* ]]; then b="$DOMAIN"; fi
  printf '%s' "$b"
}

# mkdir -p + chmod 777 each target, elevating once if any nearest existing
# ancestor isn't writable (same policy as create_folders).
ensure_dirs() {
  local SUDO="" d probe
  for d in "$@"; do
    probe="$d"; while [[ ! -e "$probe" ]]; do probe="$(dirname "$probe")"; done
    if [[ $EUID -ne 0 && ! -w "$probe" ]]; then SUDO="sudo"; fi
  done
  if [[ -n "$SUDO" ]]; then
    say "Target isn't writable by you — elevating (enter your sudo password):"
    sudo -v
  fi
  for d in "$@"; do $SUDO mkdir -p "$d"; $SUDO chmod 777 "$d"; done
}

# Read VAR=value from an env file; empty if absent/unreadable.
read_env_var() {
  local file="$1" var="$2"
  [[ -r "$file" ]] || { printf ''; return 0; }
  sed -n "s/^${var}=//p" "$file" | head -n1
}

# Back up an existing output file before overwriting; returns 1 to abort.
guard_overwrite() {
  local f="$1"
  [[ -e "$f" ]] || return 0
  say "!! $f already exists (it may hold real secrets)."
  yesno "Back it up and overwrite?" || { say "Skipped $f."; return 1; }
  local n=1; while [[ -e "$f.bak-$n" ]]; do n=$((n+1)); done
  cp -p "$f" "$f.bak-$n"; say "Backed up to $f.bak-$n"
}

# --- Menu actions ----------------------------------------------------------
set_data_root() {
  local p; p="$(ask "Data root (absolute path)" "$DATA_ROOT")"; p="${p%/}"
  valid_root "$p" || { say "Refusing '$p' — give an absolute, non-root path."; return; }
  DATA_ROOT="$p"; say "Data root = $DATA_ROOT"
}

set_domain() {
  DOMAIN="$(ask "Public domain (hostname Traefik routes)" "$DOMAIN")"
  say "Domain = $DOMAIN"
}

create_folders() {
  valid_root "$DATA_ROOT" || { say "Set a valid data root first."; return; }
  say "Will create under: $DATA_ROOT"
  local row key; for row in "${STORAGE[@]}"; do IFS='|' read -r key _ _ <<<"$row"; printf '  %s/\n' "$key"; done
  yesno "Proceed?" || { say "Aborted."; return; }

  # Elevate only if the nearest existing ancestor isn't writable.
  local probe="$DATA_ROOT" SUDO=""
  while [[ ! -e "$probe" ]]; do probe="$(dirname "$probe")"; done
  if [[ $EUID -ne 0 && ! -w "$probe" ]]; then
    say "Target isn't writable by you — elevating (enter your sudo password):"
    sudo -v; SUDO="sudo"
  fi

  local key; for row in "${STORAGE[@]}"; do IFS='|' read -r key _ _ <<<"$row"; $SUDO mkdir -p "$DATA_ROOT/$key"; done
  $SUDO chmod -R 777 "$DATA_ROOT"
  say "Created and chmod 777:"
  if command -v tree >/dev/null 2>&1; then tree -d "$DATA_ROOT"
  else find "$DATA_ROOT" -type d | sort | sed "s#^$DATA_ROOT#  .#"; fi
}

USE_GRABBIT=0   # set by write_env, read by write_compose

write_env() {
  guard_overwrite "$ENV_OUT" || return 0

  hr; say "Generating $ENV_OUT — required values first."
  local admin_email admin_pass app_url vapid_subject
  admin_email="$(ask "Admin email (first admin account)" "admin@$DOMAIN")"
  admin_pass="$(ask_secret "Admin password")"
  app_url="$(ask "Public app URL" "https://$DOMAIN")"

  # Auto-generated secrets.
  local jwt import_secret grabbit_token appupd_secret vpub vpriv
  jwt="$(gen_secret_b64)"
  import_secret="$(gen_secret_hex)"
  appupd_secret="$(gen_secret_hex)"
  read -r vpub vpriv < <(gen_vapid) || true
  vapid_subject="$(ask "VAPID subject (mailto: for push)" "mailto:$admin_email")"

  # Optional groups.
  local smtp=0 sh="" sp="" su="" spw="" mf=""
  if yesno "Configure SMTP email invites now?"; then
    smtp=1
    sh="$(ask "SMTP host" "smtp.gmail.com")"; sp="$(ask "SMTP port" "465")"
    su="$(ask "SMTP user")"; spw="$(ask_secret "SMTP pass")"
    mf="$(ask "Mail from" "Elite <$su>")"
  fi
  local owners=0 pe="" ppw="" ae="" apw=""
  if yesno "Seed content-owner accounts (public / adults)?"; then
    owners=1
    pe="$(ask "PUBLIC_EMAIL" "public@$DOMAIN")"; ppw="$(ask_secret "PUBLIC_PASSWORD")"
    ae="$(ask "ADULTS_EMAIL" "adults@$DOMAIN")"; apw="$(ask_secret "ADULTS_PASSWORD")"
  fi
  local pin=""
  if yesno "Set an 18+ PIN?"; then pin="$(ask "SHORTS_18_PIN")"; fi
  USE_GRABBIT=0
  if yesno "Use the grabbit media grabber (shorts Grab tab)?"; then USE_GRABBIT=1; fi
  GRABBIT_TOKEN=""
  if [[ $USE_GRABBIT -eq 1 ]]; then GRABBIT_TOKEN="$(gen_secret_hex)"; fi

  {
    echo "# Elite v2 environment — generated by scripts/setup.sh"
    echo "# Secrets are real; lines marked CHANGE_ME need your input. Never commit this file."
    echo
    echo "# --- Required ---"
    echo "JWT_SECRET=$jwt"
    echo "ADMIN_EMAIL=$admin_email"
    echo "ADMIN_PASSWORD=$admin_pass"
    echo "APP_URL=$app_url"
    echo "IMPORT_CRON_SECRET=$import_secret"
    echo
    echo "# --- Web Push (optional; push no-ops if blank) ---"
    if [[ -n "$vpub" && -n "$vpriv" ]]; then
      echo "VAPID_PUBLIC_KEY=$vpub"
      echo "VAPID_PRIVATE_KEY=$vpriv"
    else
      echo "# Could not auto-generate VAPID keys. Run: npx web-push generate-vapid-keys"
      echo "# VAPID_PUBLIC_KEY=CHANGE_ME"
      echo "# VAPID_PRIVATE_KEY=CHANGE_ME"
    fi
    echo "VAPID_SUBJECT=$vapid_subject"
    echo
    echo "# --- Email invites (optional) ---"
    if [[ $smtp -eq 1 ]]; then
      echo "SMTP_HOST=$sh"; echo "SMTP_PORT=$sp"; echo "SMTP_USER=$su"
      echo "SMTP_PASS=$spw"; echo "MAIL_FROM=$mf"
    else
      echo "# SMTP_HOST=smtp.gmail.com"; echo "# SMTP_PORT=465"
      echo "# SMTP_USER=CHANGE_ME"; echo "# SMTP_PASS=CHANGE_ME"; echo "# MAIL_FROM=Elite <CHANGE_ME>"
    fi
    echo
    echo "# --- Content-owner accounts (optional) ---"
    if [[ $owners -eq 1 ]]; then
      echo "PUBLIC_EMAIL=$pe"; echo "PUBLIC_PASSWORD=$ppw"
      echo "ADULTS_EMAIL=$ae"; echo "ADULTS_PASSWORD=$apw"
    else
      echo "# PUBLIC_EMAIL=CHANGE_ME"; echo "# PUBLIC_PASSWORD=CHANGE_ME"
      echo "# ADULTS_EMAIL=CHANGE_ME"; echo "# ADULTS_PASSWORD=CHANGE_ME"
    fi
    echo
    echo "# --- 18+ PIN (optional) ---"
    if [[ -n "$pin" ]]; then echo "SHORTS_18_PIN=$pin"; else echo "# SHORTS_18_PIN=CHANGE_ME"; fi
    echo
    echo "# --- grabbit media grabber (optional) ---"
    if [[ $USE_GRABBIT -eq 1 ]]; then
      echo "# Paste this SAME token into grabbit's own .env as GRABBIT_INTERNAL_TOKEN:"
      echo "GRABBIT_INTERNAL_TOKEN=$GRABBIT_TOKEN"
    else
      echo "# GRABBIT_INTERNAL_TOKEN=CHANGE_ME"
    fi
    echo
    echo "# --- App Store auto-update (optional) ---"
    echo "APP_UPDATE_SECRET=$appupd_secret"
    echo "# GITHUB_TOKEN=CHANGE_ME   # raises GitHub API rate limit"
    echo
    echo "# --- Dashboard weather widget (optional; has defaults) ---"
    echo "# WEATHER_PLACE=Stockholm"
    echo "# WEATHER_LAT=59.3293"
    echo "# WEATHER_LON=18.0686"
  } > "$ENV_OUT"

  chmod 600 "$ENV_OUT"
  say "Wrote $ENV_OUT (chmod 600)."
  if [[ -n "${GRABBIT_TOKEN:-}" ]]; then
    say ">> grabbit token: $GRABBIT_TOKEN  (put the same value in grabbit's .env)"
  fi
  if [[ -z "$vpub" || -z "$vpriv" ]]; then
    say ">> VAPID not generated — run: npx web-push generate-vapid-keys"
  fi
}

write_compose() {
  valid_root "$DATA_ROOT" || { say "Set a valid data root first."; return; }
  guard_overwrite "$COMPOSE_OUT" || return 0

  local docker_gid=""
  if command -v getent >/dev/null 2>&1; then docker_gid="$(getent group docker | cut -d: -f3 || true)"; fi

  {
    echo "# docker-compose.yml — generated by scripts/setup.sh"
    echo "services:"
    echo "  elitev2:"
    echo "    build:"
    echo "      context: ."
    echo "      dockerfile: Dockerfile"
    echo "    container_name: elitev2"
    echo "    restart: unless-stopped"
    echo "    networks: [traefik]"
    echo "    env_file: .env"
    echo "    environment:"
    echo "      - NODE_ENV=production"
    echo "      - PORT=3000"
    echo "      - HOSTNAME=0.0.0.0"
    local row key cpath var
    for row in "${STORAGE[@]}"; do
      IFS='|' read -r key cpath var <<<"$row"
      echo "      - $var=$cpath"
      [[ "$key" == "instagram" ]] && echo "      - IG_COOKIES_PATH=$cpath/cookies.txt"
      [[ "$key" == "tiktok" ]]    && echo "      - TIKTOK_COOKIES_PATH=$cpath/cookies.txt"
    done
    echo "      - WEATHER_PLACE=\${WEATHER_PLACE:-Stockholm}"
    echo "      - WEATHER_LAT=\${WEATHER_LAT:-59.3293}"
    echo "      - WEATHER_LON=\${WEATHER_LON:-18.0686}"
    if [[ "${USE_GRABBIT:-0}" -eq 1 ]]; then
      echo "      - GRABBIT_URL=http://grabbit:3000"
      echo "      - GRABBIT_INTERNAL_TOKEN=\${GRABBIT_INTERNAL_TOKEN}"
    fi
    echo "    volumes:"
    echo "      - elitev2_data:/app/data"
    for row in "${STORAGE[@]}"; do
      IFS='|' read -r key cpath var <<<"$row"
      echo "      - $DATA_ROOT/$key:$cpath"
    done
    echo "      # Optional: Docker dashboard widget (uncomment both this and group_add)"
    echo "      # - /var/run/docker.sock:/var/run/docker.sock:ro"
    if [[ -n "$docker_gid" ]]; then
      echo "    # group_add:"
      echo "    #   - \"$docker_gid\"   # host 'docker' group GID (auto-detected)"
    else
      echo "    # group_add:"
      echo "    #   - \"999\"   # set to: getent group docker | cut -d: -f3"
    fi
    echo "    labels:"
    echo "      - \"traefik.enable=true\""
    echo "      - \"traefik.http.routers.elitev2-secure.rule=Host(\`$DOMAIN\`)\""
    echo "      - \"traefik.http.routers.elitev2-secure.entrypoints=https\""
    echo "      - \"traefik.http.routers.elitev2-secure.tls=true\""
    echo "      - \"traefik.http.routers.elitev2-secure.tls.certresolver=cloudflare\""
    echo "      - \"traefik.http.services.elitev2-service.loadbalancer.server.port=3000\""
    echo
    echo "volumes:"
    echo "  elitev2_data:"
    echo
    echo "networks:"
    echo "  traefik:"
    echo "    external: true"
  } > "$COMPOSE_OUT"

  say "Wrote $COMPOSE_OUT (domain $DOMAIN, data root $DATA_ROOT)."
}

# --- Traefik reverse-proxy stack --------------------------------------------
write_traefik() {
  hr; say "Traefik reverse proxy -> $TRAEFIK_DIR/"
  say "Generates a compose file, static config (traefik.yml), .env and acme.json."
  local base acme_email cf_token tz
  base="$(ask "Base domain (wildcard cert covers *.<base>)" "$(base_domain)")"
  acme_email="$(ask "ACME / Cloudflare account email" "admin@$base")"
  cf_token="$(ask_secret "Cloudflare DNS API token (blank = CHANGE_ME later)")"
  tz="$(ask "Timezone" "Europe/Stockholm")"

  mkdir -p "$TRAEFIK_DIR"
  guard_overwrite "$TRAEFIK_DIR/.env" || return 0
  guard_overwrite "$TRAEFIK_DIR/traefik.yml" || return 0
  guard_overwrite "$TRAEFIK_DIR/docker-compose.yml" || return 0

  {
    echo "# Traefik environment — generated by scripts/setup.sh. Never commit this file."
    echo "CF_API_EMAIL=$acme_email"
    if [[ -n "$cf_token" ]]; then echo "CF_DNS_API_TOKEN=$cf_token"
    else echo "CF_DNS_API_TOKEN=CHANGE_ME"; fi
    echo "TZ=$tz"
  } > "$TRAEFIK_DIR/.env"
  chmod 600 "$TRAEFIK_DIR/.env"

  cat > "$TRAEFIK_DIR/traefik.yml" <<EOF
# traefik.yml (static config) — generated by scripts/setup.sh
api:
  dashboard: false

entryPoints:
  http:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: https
          scheme: https
  https:
    address: ":443"

# The generated services are plain-HTTP backends, so backend TLS verification
# never applies. Only uncomment if you later route to a self-signed HTTPS
# backend — it disables certificate checks for ALL backends.
# serversTransport:
#   insecureSkipVerify: true

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    # Only containers that opt in with traefik.enable=true are routed.
    exposedByDefault: false

certificatesResolvers:
  cloudflare:
    acme:
      email: $acme_email
      storage: "acme.json"
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "1.0.0.1:53"
EOF

  cat > "$TRAEFIK_DIR/docker-compose.yml" <<EOF
# docker-compose.yml (Traefik) — generated by scripts/setup.sh
services:
  traefik:
    image: traefik:v3.6
    container_name: traefik
    restart: unless-stopped
    networks: [traefik]
    ports:
      - "80:80"
      - "443:443"
    env_file: .env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /etc/localtime:/etc/localtime:ro
      - ./traefik.yml:/traefik.yml:ro
      - ./acme.json:/acme.json

networks:
  traefik:
    external: true
EOF

  # acme.json must exist with 0600 perms or Traefik refuses to store certs.
  [[ -e "$TRAEFIK_DIR/acme.json" ]] || : > "$TRAEFIK_DIR/acme.json"
  chmod 600 "$TRAEFIK_DIR/acme.json"

  say "Wrote $TRAEFIK_DIR/{docker-compose.yml,traefik.yml,.env,acme.json}."
  say "Create the shared network once: docker network create traefik"
  if [[ -z "$cf_token" ]]; then
    say ">> Set CF_DNS_API_TOKEN in $TRAEFIK_DIR/.env before starting."
  fi
}

# --- grabbit media-grabber stack ---------------------------------------------
write_grabbit() {
  valid_root "$DATA_ROOT" || { say "Set a valid data root first."; return; }
  hr; say "grabbit media grabber -> $GRABBIT_DIR/"
  say "Backs the shorts Grab tab (internal http://grabbit:3000) + a public, password-gated UI."
  local gdomain src gpass gsecret token
  gdomain="$(ask "grabbit public domain" "grabbit.$(base_domain)")"
  src="$(ask "grabbit source (local clone path or git URL)" "https://github.com/tjelite1986/grabbit.git")"
  gpass="$(ask_secret "grabbit web UI password")"
  gsecret="$(gen_secret_hex)"

  # The internal token must match elite-v2's GRABBIT_INTERNAL_TOKEN. Reuse the
  # one from this session or the generated .env; only mint a new one if neither
  # exists, and then remind the user to copy it across.
  token="${GRABBIT_TOKEN:-}"
  [[ -z "$token" ]] && token="$(read_env_var "$ENV_OUT" GRABBIT_INTERNAL_TOKEN)"
  local minted=0
  if [[ -z "$token" ]]; then token="$(gen_secret_hex)"; minted=1; fi
  GRABBIT_TOKEN="$token"

  mkdir -p "$GRABBIT_DIR"
  guard_overwrite "$GRABBIT_DIR/.env" || return 0
  guard_overwrite "$GRABBIT_DIR/docker-compose.yml" || return 0

  {
    echo "# grabbit environment — generated by scripts/setup.sh. Never commit this file."
    echo "GRABBIT_PASSWORD=$gpass"
    echo "GRABBIT_SECRET=$gsecret"
    echo "# Must match GRABBIT_INTERNAL_TOKEN in elite-v2's .env."
    echo "GRABBIT_INTERNAL_TOKEN=$token"
  } > "$GRABBIT_DIR/.env"
  chmod 600 "$GRABBIT_DIR/.env"

  cat > "$GRABBIT_DIR/docker-compose.yml" <<EOF
# docker-compose.yml (grabbit) — generated by scripts/setup.sh
services:
  grabbit:
    build:
      context: $src
      dockerfile: Dockerfile
    container_name: grabbit
    restart: unless-stopped
    networks: [traefik]
    env_file: .env
    environment:
      - ELITE_ROOT=/elitev2-shorts
      # Max clip length (seconds) allowed into the shorts library; longer
      # videos are routed to the download library instead. 0 disables it.
      - SHORTS_MAX_DURATION=600
      # Plain download library, auto-routed by type.
      - DOWNLOAD_DIR=/downloads
      - VIDEOS_DOWNLOAD_DIR=/downloads/videos
      - AUDIO_DOWNLOAD_DIR=/downloads/mp3
      - ADULTS_DOWNLOAD_DIR=/downloads/adults
      - PHOTOS_DOWNLOAD_DIR=/downloads/photos
    volumes:
      - $DATA_ROOT/grabbit/data:/data
      # elite-v2 shorts store: files saved under <channel>/_import are
      # picked up by the shorts import job.
      - $DATA_ROOT/shorts:/elitev2-shorts
      - $DATA_ROOT/grabbit/downloads:/downloads
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.grabbit-secure.rule=Host(\`$gdomain\`)"
      - "traefik.http.routers.grabbit-secure.entrypoints=https"
      - "traefik.http.routers.grabbit-secure.tls=true"
      - "traefik.http.routers.grabbit-secure.tls.certresolver=cloudflare"
      - "traefik.http.services.grabbit-service.loadbalancer.server.port=3000"

networks:
  traefik:
    external: true
EOF

  if yesno "Create grabbit host folders under $DATA_ROOT now?"; then
    ensure_dirs "$DATA_ROOT/grabbit/data" \
      "$DATA_ROOT/grabbit/downloads/videos" "$DATA_ROOT/grabbit/downloads/mp3" \
      "$DATA_ROOT/grabbit/downloads/adults" "$DATA_ROOT/grabbit/downloads/photos" \
      "$DATA_ROOT/shorts"
    say "Created grabbit folders."
  fi

  say "Wrote $GRABBIT_DIR/{docker-compose.yml,.env}."
  if [[ $minted -eq 1 ]]; then
    say ">> Minted a new internal token — add this line to elite-v2's .env too:"
    say ">>   GRABBIT_INTERNAL_TOKEN=$token"
  fi
}

# --- App Store update-check systemd timer ------------------------------------
# The only host-side scheduled job. Every other recurring script runs via the
# in-app scheduler (Admin -> Background jobs) and needs no setup here.
write_appupdates_timer() {
  hr; say "App Store update-check timer -> $SYSTEMD_DIR/"
  say "Note: all other jobs (imports, sync, transcode, cleanup) are scheduled"
  say "in-app under Admin -> Background jobs — nothing to install for those."
  local repo_dir node_bin app_url secret every
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  node_bin="$(command -v node || echo /usr/bin/node)"
  app_url="$(ask "App URL the checker calls" "https://$DOMAIN")"
  secret="$(read_env_var "$ENV_OUT" APP_UPDATE_SECRET)"
  if [[ -z "$secret" ]]; then
    secret="$(ask "APP_UPDATE_SECRET (from .env; blank = CHANGE_ME later)")"
    [[ -z "$secret" ]] && secret="CHANGE_ME"
  else
    say "Using APP_UPDATE_SECRET from $ENV_OUT."
  fi
  every="$(ask "Run every" "6h")"

  mkdir -p "$SYSTEMD_DIR"
  guard_overwrite "$SYSTEMD_DIR/elitev2-app-updates.service" || return 0
  guard_overwrite "$SYSTEMD_DIR/elitev2-app-updates.timer" || return 0

  cat > "$SYSTEMD_DIR/elitev2-app-updates.service" <<EOF
# App Store update checker (oneshot) — generated by scripts/setup.sh
[Unit]
Description=Elite v2 App Store update check
After=network-online.target

[Service]
Type=oneshot
Environment=APP_UPDATE_URL=$app_url
Environment=APP_UPDATE_SOURCE=all
Environment=APP_UPDATE_SECRET=$secret
# Uncomment to auto-download new releases (promoted only after APK
# signature verification passes):
# Environment=APP_UPDATE_PULL=1
ExecStart=$node_bin $repo_dir/scripts/check-app-updates.mjs
User=$(id -un)
EOF
  chmod 600 "$SYSTEMD_DIR/elitev2-app-updates.service"

  cat > "$SYSTEMD_DIR/elitev2-app-updates.timer" <<EOF
# Runs the App Store update checker on a schedule — generated by scripts/setup.sh
[Unit]
Description=Elite v2 App Store update check (schedule)

[Timer]
OnBootSec=10min
OnUnitActiveSec=$every
Persistent=true

[Install]
WantedBy=timers.target
EOF

  say "Wrote $SYSTEMD_DIR/elitev2-app-updates.{service,timer}."
  if [[ "$secret" == "CHANGE_ME" ]]; then
    say ">> Fill in APP_UPDATE_SECRET in the .service file before installing."
  fi
  if yesno "Install and enable the timer now (sudo)?"; then
    sudo cp "$SYSTEMD_DIR/elitev2-app-updates.service" "$SYSTEMD_DIR/elitev2-app-updates.timer" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now elitev2-app-updates.timer
    say "Installed and enabled elitev2-app-updates.timer."
  else
    say "To install later:"
    say "  sudo cp $SYSTEMD_DIR/elitev2-app-updates.* /etc/systemd/system/"
    say "  sudo systemctl daemon-reload && sudo systemctl enable --now elitev2-app-updates.timer"
  fi
}

show_summary() {
  hr
  say "Data root : $DATA_ROOT"
  say "Domain    : $DOMAIN"
  say ".env      : $ENV_OUT      $([[ -e "$ENV_OUT" ]] && echo '[exists]' || echo '[missing]')"
  say "compose   : $COMPOSE_OUT  $([[ -e "$COMPOSE_OUT" ]] && echo '[exists]' || echo '[missing]')"
  say "traefik   : $TRAEFIK_DIR/   $([[ -e "$TRAEFIK_DIR/docker-compose.yml" ]] && echo '[exists]' || echo '[missing]')"
  say "grabbit   : $GRABBIT_DIR/   $([[ -e "$GRABBIT_DIR/docker-compose.yml" ]] && echo '[exists]' || echo '[missing]')"
  say "timer     : $SYSTEMD_DIR/   $([[ -e "$SYSTEMD_DIR/elitev2-app-updates.timer" ]] && echo '[exists]' || echo '[missing]')"
  say "Storage   : $(for r in "${STORAGE[@]}"; do IFS='|' read -r k _ _ <<<"$r"; printf '%s ' "$k"; done)"
  hr
  say "Next: docker network create traefik   (once, if it doesn't exist)"
  say "      docker compose up -d            (in $TRAEFIK_DIR/, then $GRABBIT_DIR/)"
  say "      docker compose build && docker compose up -d   (elite-v2 itself)"
  say "Recurring jobs: enable them in-app under Admin -> Background jobs."
}

do_everything() {
  create_folders; write_env; write_compose
  if yesno "Generate the Traefik reverse-proxy stack too?"; then write_traefik; fi
  if [[ "${USE_GRABBIT:-0}" -eq 1 ]]; then
    if yesno "Generate the grabbit stack too?"; then write_grabbit; fi
  fi
  if yesno "Generate the App Store update-check timer (host systemd)?"; then
    write_appupdates_timer
  fi
  show_summary
}

# --- Menu loop -------------------------------------------------------------

# Interactive menu. Arrow keys (and j/k) move the highlight, typing an item's
# key (number/letter) jumps to it, Enter runs the highlighted item. Falls back
# to a plain numbered prompt when stdin isn't a TTY (piped/scripted runs).
# Usage: menu_select DEFAULT_KEY "key|label"...  — result in $MENU_CHOICE.
MENU_CHOICE=""
menu_select() {
  local default="$1"; shift
  local items=("$@") n=$# sel=0 i key label c c2 c3 drawn=0
  local ESC=$'\033'

  if [[ ! -t 0 ]]; then
    for i in "${!items[@]}"; do
      IFS='|' read -r key label <<<"${items[$i]}"
      say "  $key) $label"
    done
    MENU_CHOICE="$(ask "Choose" "$default")"
    return 0
  fi

  for i in "${!items[@]}"; do
    IFS='|' read -r key _ <<<"${items[$i]}"
    if [[ "$key" == "$default" ]]; then sel=$i; fi
  done

  tput civis 2>/dev/null || true
  while true; do
    if [[ $drawn -eq 1 ]]; then printf '\033[%dA' "$n"; fi
    for i in "${!items[@]}"; do
      IFS='|' read -r key label <<<"${items[$i]}"
      if [[ $i -eq $sel ]]; then
        printf '\033[7m> %s) %s\033[0m\033[K\n' "$key" "$label"
      else
        printf '  %s) %s\033[K\n' "$key" "$label"
      fi
    done
    drawn=1
    IFS= read -rsn1 c || c=""
    case "$c" in
      "$ESC")
        read -rsn1 -t 0.05 c2 || c2=""
        read -rsn1 -t 0.05 c3 || c3=""
        case "$c2$c3" in
          "[A") sel=$(( (sel - 1 + n) % n )) ;;
          "[B") sel=$(( (sel + 1) % n )) ;;
        esac ;;
      k) sel=$(( (sel - 1 + n) % n )) ;;
      j) sel=$(( (sel + 1) % n )) ;;
      "")
        IFS='|' read -r key _ <<<"${items[$sel]}"
        MENU_CHOICE="$key"; break ;;
      *)
        # A typed key highlights its item; Enter confirms (like the old
        # number-then-Enter flow, so a habitual trailing Enter is harmless).
        for i in "${!items[@]}"; do
          IFS='|' read -r key _ <<<"${items[$i]}"
          if [[ "${c,,}" == "${key,,}" ]]; then sel=$i; fi
        done ;;
    esac
  done
  tput cnorm 2>/dev/null || true
}

main() {
  command -v openssl >/dev/null 2>&1 || { say "openssl is required."; exit 1; }
  trap 'tput cnorm 2>/dev/null || true' EXIT
  while true; do
    hr
    say "Elite v2 setup  (arrows move, number/letter jumps, Enter runs)"
    menu_select "9" \
      "1|Set data root        (current: $DATA_ROOT)" \
      "2|Set public domain    (current: $DOMAIN)" \
      "3|Create storage folders" \
      "4|Generate .env        (-> $ENV_OUT)" \
      "5|Generate docker-compose.yml (-> $COMPOSE_OUT)" \
      "6|Generate Traefik stack      (-> $TRAEFIK_DIR/)" \
      "7|Generate grabbit stack      (-> $GRABBIT_DIR/)" \
      "8|Generate App Store update timer (-> $SYSTEMD_DIR/)" \
      "9|Do everything (3 -> 4 -> 5, then optional 6 -> 7 -> 8)" \
      "s|Show summary" \
      "0|Quit"
    case "$MENU_CHOICE" in
      1) set_data_root ;;
      2) set_domain ;;
      3) create_folders ;;
      4) write_env ;;
      5) write_compose ;;
      6) write_traefik ;;
      7) write_grabbit ;;
      8) write_appupdates_timer ;;
      9) do_everything ;;
      s|S) show_summary ;;
      0) say "Bye."; exit 0 ;;
      *) say "Unknown choice: $choice" ;;
    esac
  done
}

main "$@"
