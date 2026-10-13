/**
 * "Something changed in this vendor's online orders" counter, kept in Upstash —
 * not Postgres.
 *
 * The vendor's orders board wants to notice new orders quickly. Polling
 * Postgres for that would pin Neon awake for as long as the board is open
 * (see the global scale-to-zero rule). Instead, order placement bumps a KV
 * counter; the board polls this cheap counter and refetches from Postgres only
 * when the number moves.
 *
 * One counter per vendor: the board lists menu orders and every drop's orders
 * together, so a change to any of them is a reason to refetch.
 *
 * Fail-open both ways: no KV → bump is a no-op and reads return null, and the
 * board falls back to a slow (6 min) direct refresh.
 */

import { getKv } from "@/lib/kv";

const TTL_SECONDS = 3 * 24 * 60 * 60;

/** Vendor-scoped, so a vendor can only ever read their own counter. */
function key(vendorId: string): string {
  return `orders:${vendorId}`;
}

/** Never throws, never awaited by the order path. */
export async function bumpOrderSignal(vendorId: string): Promise<void> {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.incr(key(vendorId));
    await kv.expire(key(vendorId), TTL_SECONDS);
  } catch {
    // Signal is an optimisation; the board still refreshes on its slow path.
  }
}

/** Current counter value, or null when KV is unavailable (caller falls back). */
export async function getOrderSignal(vendorId: string): Promise<number | null> {
  const kv = getKv();
  if (!kv) return null;
  try {
    const v = await kv.get<number | string>(key(vendorId));
    if (v === null || v === undefined) return 0;
    const n = typeof v === "number" ? v : Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}
