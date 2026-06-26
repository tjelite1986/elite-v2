/** @type {import('next').NextConfig} */
const nextConfig = {
  // No "output: standalone" — we run a custom server (server.mjs) to host the
  // WebSocket endpoint (/api/ws) alongside Next, which standalone can't do.
  reactStrictMode: true,
  // archiver (zip download) is ESM with a transitive dep whose package.json
  // `exports` order webpack rejects; load it from node_modules at runtime.
  experimental: {
    serverComponentsExternalPackages: ["archiver"],
  },
};

export default nextConfig;
