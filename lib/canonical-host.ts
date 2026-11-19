/**
 * Moving the app to a new domain (docs/DOMAIN_MOVE_PLAN.md). Pure and edge-safe:
 * the middleware (via lib/auth.config.ts) and the vendor layout both read it.
 *
 * Nothing happens until `CANONICAL_HOST` is set. Then a page request on a
 * legacy host gets a 308 to the same path and query on the canonical host,
 * except what an old install or a third party still calls on the old host:
 *
 * - `/api/**`: Razorpay webhooks pasted into sellers' own dashboards (senders
 *   don't follow redirects), offline-outbox POSTs from an app installed on the
 *   old origin (a cross-origin redirect fails CORS and drops the sale), crons,
 *   probes, push.
 * - PWA files (`/sw.js`, manifests, icons): the old origin's service worker and
 *   Home Screen apps keep fetching them.
 * - Anything but GET / HEAD: a server action posts to the page's own path.
 * - `/pos`, until `LEGACY_HOST_REDIRECT_POS` is set: queued counter sales live
 *   in the old origin's IndexedDB and only sync when `/pos` loads there.
 */

/** Hosts the app has been served on before. Never remove one: printed QR codes carry them. */
export const LEGACY_HOSTS: readonly string[] = ["awaazos.intelliforge.tech", "awaazos.vercel.app"];

/** Hosts that serve production today or will after the move. The e2e guard refuses all of them. */
export const PRODUCTION_HOSTS: readonly string[] = [...LEGACY_HOSTS, "awaazdo.store", "www.awaazdo.store"];

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const PWA_FILES = new Set([
  "/sw.js",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/badge-72.png",
]);

/** "AwaazDo.Store:443" → "awaazdo.store". Null for anything that isn't a plain hostname. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return HOSTNAME.test(host) ? host : null;
}

/** The canonical host from `CANONICAL_HOST`, or null when the move hasn't started. */
export function canonicalHostFrom(env: string | undefined): string | null {
  return normaliseHost(env);
}

/** True when this request came in on a host we're moving away from. */
export function isLegacyHost(host: string | null | undefined, canonicalHost: string | null): boolean {
  const h = normaliseHost(host);
  return !!h && !!canonicalHost && h !== canonicalHost && LEGACY_HOSTS.includes(h);
}

function isPosPath(pathname: string): boolean {
  return pathname === "/pos" || pathname.startsWith("/pos/");
}

/** Old installs and third parties call these on the old host: never redirect them. */
function isExempt(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (PWA_FILES.has(pathname)) return true;
  // A store's own buyer app: /s/<slug>/manifest.webmanifest and /s/<slug>/app-icon/<size>.
  if (/^\/s\/[^/]+\/(manifest\.webmanifest|app-icon(\/.*)?)$/.test(pathname)) return true;
  return false;
}

/** The URL to 308 to, or null to serve the request where it is. */
export function legacyHostRedirect(input: {
  host: string | null | undefined;
  method: string;
  pathname: string;
  search: string;
  canonicalHost: string | null;
  redirectPos: boolean;
}): string | null {
  const { canonicalHost, pathname } = input;
  if (!isLegacyHost(input.host, canonicalHost)) return null;
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  if (isExempt(pathname)) return null;
  if (isPosPath(pathname) && !input.redirectPos) return null;
  return `https://${canonicalHost}${pathname}${input.search}`;
}

/** "1" / "true" → true. */
export function flagOn(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true";
}
