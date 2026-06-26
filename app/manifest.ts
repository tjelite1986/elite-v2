import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest — makes the app installable to the home
// screen on mobile/tablet (standalone, no browser chrome).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elite",
    short_name: "Elite",
    description: "Your personal hub — photos, shorts, posts and chat.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#121212",
    theme_color: "#121212",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
