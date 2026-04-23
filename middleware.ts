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
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/health|api/ready).*)",
  ],
};
