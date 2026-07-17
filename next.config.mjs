// Everything is self-hosted except the OSM tile servers (gallery map).
// 'unsafe-inline' script/style is required by Next's hydration payload and
// Tailwind/styled-jsx; blob: frames/workers by the EPUB (iframe) and PDF
// (worker) readers; ws:/wss: by the /api/ws socket.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No "output: standalone" — we run a custom server (server.mjs) to host the
  // WebSocket endpoint (/api/ws) alongside Next, which standalone can't do.
  reactStrictMode: true,
  // archiver (zip download) is ESM with a transitive dep whose package.json
  // `exports` order webpack rejects; load it from node_modules at runtime.
  serverExternalPackages: ["archiver"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
