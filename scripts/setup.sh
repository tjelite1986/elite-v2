#!/usr/bin/env bash
#
# Elite v2 setup wizard.
#
# An interactive, menu-driven installer that takes a fresh instance from nothing
# to a ready-to-`docker compose up` state:
#   - create the host storage folder tree
#   - generate a .env (auto-filled secrets + prompted values + optional placeholders)
#   - generate a matching docker-compose.yml (container-path env + host mounts + labels)
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
  guard_overwrite "$ENV_OUT" || return

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
  guard_overwrite "$COMPOSE_OUT" || return

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

show_summary() {
  hr
  say "Data root : $DATA_ROOT"
  say "Domain    : $DOMAIN"
  say ".env      : $ENV_OUT      $([[ -e "$ENV_OUT" ]] && echo '[exists]' || echo '[missing]')"
  say "compose   : $COMPOSE_OUT  $([[ -e "$COMPOSE_OUT" ]] && echo '[exists]' || echo '[missing]')"
  say "Storage   : $(for r in "${STORAGE[@]}"; do IFS='|' read -r k _ _ <<<"$r"; printf '%s ' "$k"; done)"
  hr
  say "Next: docker compose build && docker compose up -d"
}

do_everything() { create_folders; write_env; write_compose; show_summary; }

# --- Menu loop -------------------------------------------------------------
main() {
  command -v openssl >/dev/null 2>&1 || { say "openssl is required."; exit 1; }
  while true; do
    hr
    say "Elite v2 setup"
    say "  1) Set data root        (current: $DATA_ROOT)"
    say "  2) Set public domain    (current: $DOMAIN)"
    say "  3) Create storage folders"
    say "  4) Generate .env        (-> $ENV_OUT)"
    say "  5) Generate docker-compose.yml (-> $COMPOSE_OUT)"
    say "  6) Do everything (3 -> 4 -> 5)"
    say "  7) Show summary"
    say "  0) Quit"
    local choice; choice="$(ask "Choose" "6")"
    case "$choice" in
      1) set_data_root ;;
      2) set_domain ;;
      3) create_folders ;;
      4) write_env ;;
      5) write_compose ;;
      6) do_everything ;;
      7) show_summary ;;
      0) say "Bye."; exit 0 ;;
      *) say "Unknown choice: $choice" ;;
    esac
  done
}

main "$@"
