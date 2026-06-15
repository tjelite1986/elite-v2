/** @type {import('next').NextConfig} */
const nextConfig = {
  // No "output: standalone" — we run a custom server (server.mjs) to host the
  // WebSocket endpoint (/api/ws) alongside Next, which standalone can't do.
  reactStrictMode: true,
};

export default nextConfig;
