import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * Needed for phone alerts on iPhone: iOS (16.4+) only allows web push for a
 * site added to the Home Screen and opened from there. Colours mirror the
 * design tokens in app/globals.css (--primary 24 100% 50% → #FF6600,
 * --background white). The manifest can't read CSS variables, so they are
 * literal here.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AwaazOS",
    short_name: "AwaazOS",
    description: "Voice-first POS and UPI billing for Indian vendors.",
    id: "/",
    start_url: "/pos",
    scope: "/",
    display: "standalone",
    theme_color: "#FF6600",
    background_color: "#FFFFFF",
    // Long-press on the Home Screen icon (Android). The same destinations as
    // the app shell's tabs (lib/app-nav.ts); each page enforces its own role.
    shortcuts: [
      { name: "Orders", url: "/orders", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "New drop", url: "/drops/new", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Sell", url: "/pos", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
