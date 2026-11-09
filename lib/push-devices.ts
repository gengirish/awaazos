/**
 * Server-side helpers for the Web Push device list (/api/push/*, Settings).
 *
 * The push endpoint URL is effectively a credential (anyone holding it plus
 * the keys can push to that phone), so it never leaves the server: clients
 * see only `endpointHash` = SHA-256 hex of the endpoint, which the browser
 * can compute for its own subscription to recognise "This phone".
 */
import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { makeLimiter } from "@/lib/ratelimit";
import { AuthError } from "@/lib/rbac";

/** Max opted-in devices per staff member per vendor. */
export const MAX_DEVICES_PER_USER = 10;

/** 5 test alerts per user per minute — each one fans out to real push services. */
export const pushTestRateLimit = makeLimiter({ name: "push-test", windowMs: 60_000, max: 5 });

export function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * The browsers' push services. Every new order POSTs to each saved endpoint
 * from our server, so an endpoint on any other host would let a staff member
 * point our server at a URL of their choosing.
 * Chrome, Android, Samsung Internet, Opera → FCM; Firefox → Mozilla;
 * Safari / iOS Home Screen apps → Apple; Edge → Windows Push.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "web.push.apple.com"];
const PUSH_SERVICE_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s));
}

export const subscribeSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .url()
    .refine(isPushServiceEndpoint, { message: "Endpoint must be a browser push service URL" }),
  keys: z.object({
    // Uncompressed P-256 public key = 65 bytes ≈ 87 base64url chars.
    p256dh: z.string().min(80).max(120).regex(BASE64URL, "Must be base64url"),
    // 16-byte auth secret ≈ 22 base64url chars.
    auth: z.string().min(16).max(48).regex(BASE64URL, "Must be base64url"),
  }),
  label: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

/** Prisma filter: subscriptions whose owner is still active staff of `vendorId`. */
export function activeStaffDeviceWhere(vendorId: string) {
  return { vendorId, user: { staffMemberships: { some: { vendorId, isActive: true } } } };
}

/** All opted-in devices of the vendor's active staff (Settings hub status). */
export function countVendorPushDevices(vendorId: string): Promise<number> {
  return prisma.pushSubscription.count({ where: activeStaffDeviceWhere(vendorId) });
}

export function withVendorCookie(res: NextResponse, slug: string | null): NextResponse {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export const pushNotConfigured = () => NextResponse.json({ error: "push_not_configured" }, { status: 503 });

/** Zod issues without input values (the body carries the endpoint and keys). */
export function invalidInput(err: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid input", issues: err.issues.map(({ path, message, code }) => ({ path, message, code })) },
    { status: 400 },
  );
}

export function pushErrorResponse(err: unknown, scope: string): NextResponse {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return invalidInput(err);
  // Error name only — a message could quote the endpoint.
  console.error(JSON.stringify({ event: "push_api_failed", scope, error: err instanceof Error ? err.name : "unknown" }));
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
