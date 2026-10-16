import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    // Exclude:
    //  - _next static + image optimisation
    //  - favicon
    //  - webhook callbacks (signature-verified, must accept anonymous POST)
    //  - liveness / readiness probes (must be open for uptime monitors)
    //  - health-check sub-paths (/api/health and /api/ready)
    //  - PWA files: the service worker, its offline page, web app manifest and icons
    //    (browsers fetch these without a session; a redirect breaks install/push)
    //  - food/: the dish drawings public store pages show (lib/food-images.ts)
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/health|api/ready|sw.js|offline.html|manifest.webmanifest|icon-192.png|icon-512.png|apple-touch-icon.png|badge-72.png|food/).*)",
  ],
};
