import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FairCroft CoreOne",
    short_name: "CoreOne",
    description: "FairCroft roleplay government PDA, CAD/MDT, dispatch, and DMV services.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#07111f",
    theme_color: "#07111f",
    categories: ["productivity", "utilities"],
    lang: "en-US",
    icons: [
      {
        src: "/icons/faircroft-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/faircroft-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "Civilian PDA",
        short_name: "PDA",
        description: "Open the FairCroft civilian phone OS.",
        url: "/civilian",
        icons: [{ src: "/icons/faircroft-icon.svg", sizes: "any", type: "image/svg+xml" }]
      },
      {
        name: "Department MDT",
        short_name: "MDT",
        description: "Open the department mobile data terminal.",
        url: "/mdt",
        icons: [{ src: "/icons/faircroft-icon.svg", sizes: "any", type: "image/svg+xml" }]
      },
      {
        name: "Government OS",
        short_name: "Gov",
        description: "Open DMV and government-services workflows.",
        url: "/government",
        icons: [{ src: "/icons/faircroft-icon.svg", sizes: "any", type: "image/svg+xml" }]
      }
    ]
  };
}
