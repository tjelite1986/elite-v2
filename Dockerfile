# Multi-stage build. We run a custom server (server.mjs) to host the WebSocket
# endpoint alongside Next, so we ship the full app + node_modules rather than the
# standalone output. better-sqlite3 is native and compiled in the deps stage.

FROM node:20-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production-only dependencies, with native modules recompiled for this image.
# Keeps typescript/tailwind/@types/postcss out of the runtime image.
FROM node:20-slim AS prod-deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATA_DIR=/app/data

# libheif (heif-convert) decodes iPhone HEIC/HEIF, which sharp's bundled libvips
# can't — we convert HEIC -> JPEG to generate thumbs/previews. ffmpeg/ffprobe
# read video metadata and extract poster frames for video thumbnails.
# curl drives the Instagram web_profile_info API (its TLS fingerprint dodges the
# rate limits Node's fetch hits) and gallery-dl downloads IG photos/carousels
# (yt-dlp, bind-mounted via YT_DLP_BIN, handles the videos).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libheif-examples ffmpeg curl ca-certificates python3 python3-pip \
       poppler-utils \
  && pip3 install --no-cache-dir --break-system-packages gallery-dl instaloader \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data && chown -R nextjs:nodejs /app

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json next.config.mjs server.mjs ./
# Maintenance scripts (e.g. the shorts transcoder run via `docker exec` on a
# host systemd timer). Plain .mjs, executed with the runtime node_modules.
COPY --chown=nextjs:nodejs scripts ./scripts

USER nextjs
EXPOSE 3000
CMD ["node", "server.mjs"]
