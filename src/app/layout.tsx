import type { Metadata, Viewport } from "next";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairCroft CoreOne",
  description: "Fictional roleplay CAD/MDT and civilian government services platform.",
  applicationName: "FairCroft CoreOne",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CoreOne",
    statusBarStyle: "black-translucent"
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false
  },
  icons: {
    icon: [
      { url: "/icons/faircroft-icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "CoreOne",
    "apple-touch-fullscreen": "yes"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07111f",
  colorScheme: "dark"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ background: "#07111f" }}>
      <body style={{ margin: 0, background: "#07111f", color: "#f5f7fb" }}>
        <noscript>
          <main className="center-screen">
            <section className="glass-panel access-panel">
              <p className="eyebrow">FairCroft CoreOne</p>
              <h1>JavaScript Required</h1>
              <p>This website PWA needs JavaScript enabled to run the civilian PDA, MDT, and dispatch consoles.</p>
            </section>
          </main>
        </noscript>
        {children}
        <PwaRegistrar />
      </body>
    </html>
  );
}
