import type { MetadataRoute } from "next";

import { HOME_PATH } from "@/lib/home";

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
    description: "Orders, UPI billing and receipts for home kitchens that sell on Instagram and WhatsApp.",
    // `id` is the app's identity: changing it would make every installed copy a
    // different app. `start_url` can move underneath it.
    id: "/",
    // The landing resolver: /orders for a published store, /pos otherwise
    // (lib/home.ts). With no network the service worker answers it with the
    // cached /pos instead (public/sw.js).
    start_url: HOME_PATH,
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
