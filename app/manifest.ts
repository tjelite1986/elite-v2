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
    // The ?v= is what makes a new icon reach an already-installed home screen
    // app. Android bakes the icon into a generated APK at install time and
    // only rebuilds it when it notices the manifest changed — an icon swapped
    // behind an unchanged URL is not noticed. Bump it whenever the icons are
    // regenerated.
    icons: [
      { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
