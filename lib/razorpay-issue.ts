/**
 * "Razorpay refused this store" — remembered so Settings → Payments can tell the
 * seller what to fix, instead of buyers silently falling back to UPI.
 *
 * Written only when a buyer's "Pay online" makes Razorpay refuse to create an
 * order with this store's credentials:
 *   - 401 → `auth`: the OAuth access was revoked / the pasted keys stopped working.
 *   - 400 / 403 → `account`: most often a Razorpay account whose KYC/activation
 *     isn't finished, which can't take live payments yet.
 * Cleared by the next order Razorpay accepts. Kept in Upstash with a 30-day TTL,
 * read on the Settings page only: no timer, no Postgres write on the buyer path.
 * Every call fails open — a KV outage must never block a payment.
 */

import { getKv } from "@/lib/kv";

export type RazorpayIssueKind = "auth" | "account";
export type RazorpayIssue = { kind: RazorpayIssueKind; at: string };

const TTL_SECONDS = 30 * 24 * 60 * 60;

const key = (vendorId: string) => `rzp-issue:${vendorId}`;

/** Which refusals mean "the seller has something to fix"; null for our side or transient. */
export function classifyRazorpayRefusal(status: number): RazorpayIssueKind | null {
  if (status === 401) return "auth";
  if (status === 400 || status === 403) return "account";
  return null;
}

export async function recordRazorpayIssue(vendorId: string, kind: RazorpayIssueKind, now: Date = new Date()): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.set(key(vendorId), { kind, at: now.toISOString() } satisfies RazorpayIssue, { ex: TTL_SECONDS });
  } catch {
    // Fail open.
  }
}

export async function clearRazorpayIssue(vendorId: string): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.del(key(vendorId));
  } catch {
    // Fail open.
  }
}

export async function getRazorpayIssue(vendorId: string): Promise<RazorpayIssue | null> {
  const kv = getKv();
  if (!kv) return null;
  try {
    const v = await kv.get<RazorpayIssue>(key(vendorId));
    return v && (v.kind === "auth" || v.kind === "account") && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}
