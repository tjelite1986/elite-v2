import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import PwaRegister from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "Elite",
  description: "Your personal hub — photos, shorts, posts and chat.",
  manifest: "/manifest.webmanifest",
  applicationName: "Elite",
  appleWebApp: {
    capable: true,
    title: "Elite",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#121212",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#121212] overflow-x-hidden">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
