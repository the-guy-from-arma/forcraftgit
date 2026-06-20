import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

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
    icon: "/icons/faircroft-icon.svg",
    apple: "/icons/faircroft-icon.svg"
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <PwaRegistrar />
      </body>
    </html>
  );
}
