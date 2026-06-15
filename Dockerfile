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
RUN apt-get update \
  && apt-get install -y --no-install-recommends libheif-examples ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json next.config.mjs server.mjs ./

USER nextjs
EXPOSE 3000
CMD ["node", "server.mjs"]
