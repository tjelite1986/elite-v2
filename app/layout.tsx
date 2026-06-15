import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Elite v2",
  description: "Elite hub rebuild with a macOS-inspired shell",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#121212] overflow-x-hidden">{children}</body>
    </html>
  );
}
