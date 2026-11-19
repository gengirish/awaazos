import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

import { canonicalHostFrom, flagOn, legacyHostRedirect } from "@/lib/canonical-host";

/** PWA files fetched by the browser without a session (also excluded in the middleware matcher). */
const PUBLIC_PWA_FILES = new Set([
  "/sw.js",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/badge-72.png",
  // The site's link-preview card (app/opengraph-image.png): fetched by WhatsApp / Instagram crawlers.
  "/opengraph-image.png",
]);

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (PUBLIC_PWA_FILES.has(pathname)) return true;
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
  if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return true;
  if (pathname === "/forgot-password" || pathname.startsWith("/forgot-password/")) return true;
  if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) return true;
  // Demo-store claim links (/claim/<token>). The page shows nothing unless the
  // token matches an unused, unexpired DemoHandover.
  if (pathname.startsWith("/claim/")) return true;
  // Platform-admin invite links (/admin-invite/<token>). Same rule: the page
  // shows nothing unless the token matches an unused, unexpired AdminInvite.
  if (pathname.startsWith("/admin-invite/")) return true;
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return true;
  // The public seller survey: it collects answers and shows nothing back.
  if (pathname === "/survey") return true;
  // Privacy, terms, refund, DPDP rights — linked from the public footer.
  if (pathname === "/legal" || pathname.startsWith("/legal/")) return true;
  // Public vendor storefronts. Opt-in per vendor: the route itself 404s unless
  // VendorSettings.publishStorefront is true, so this allowlist exposes nothing
  // on its own.
  if (pathname.startsWith("/s/")) return true;
  // Community pages (/c/<slug>): links to stores that accepted a listing.
  // They list only published stores, so this exposes nothing on its own.
  if (pathname.startsWith("/c/")) return true;
  // Customer receipt pages (/r/<token>). The route 404s unless the token
  // matches a Receipt.publicToken, so this allowlist exposes nothing on its own.
  if (pathname.startsWith("/r/")) return true;
  // Rider "Delivered" links (/d/<token>). The route 404s unless the token
  // matches a Transaction.riderToken, so this allowlist exposes nothing on its own.
  if (pathname.startsWith("/d/")) return true;
  // Storefront write paths (place order, submit UTR). Same opt-in gate: every
  // handler under /api/s/ 404s unless the vendor has publishStorefront = true.
  if (pathname.startsWith("/api/s/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

/**
 * Edge-safe Auth.js config — no Prisma, no Credentials provider.
 * Imported only by `middleware.ts` and spread into `lib/auth.ts`.
 */
export const authConfig = {
  pages: { signIn: "/sign-in" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      // Domain move (lib/canonical-host.ts): does nothing until CANONICAL_HOST is set.
      // Runs before the session check, so a signed-out visitor on the old host
      // signs in on the new one instead of being sent to the old /sign-in first.
      const moveTo = legacyHostRedirect({
        host: request.headers.get("host"),
        method: request.method,
        pathname,
        search: request.nextUrl.search,
        canonicalHost: canonicalHostFrom(process.env.CANONICAL_HOST),
        redirectPos: flagOn(process.env.LEGACY_HOST_REDIRECT_POS),
      });
      if (moveTo) return Response.redirect(moveTo, 308);
      if (isPublicPath(pathname)) return true;
      // App Router API routes: let handlers return JSON 401/403/402. If middleware
      // returns false, Auth.js redirects to /sign-in; fetch() follows 302/307 and
      // the response body is HTML, so clients calling /api/ai/* get JSON parse errors.
      if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
        return true;
      }
      // /(vendor)/*, /onboarding, etc. — require session; browser navigations redirect to sign-in
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? token.sub ?? "";
        token.role = (user as { role?: UserRole }).role ?? "USER";
      }
      if (!token.id && token.sub) {
        token.id = token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string);
        session.user.role = token.role as UserRole;
        // Surface the JWT issue time so Node-side guards can compare it to
        // User.passwordChangedAt. No DB access here — this file stays edge-safe.
        if (typeof token.iat === "number") {
          session.user.tokenIssuedAt = token.iat;
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
