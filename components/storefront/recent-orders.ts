/**
 * "Your recent order" memory for guests on the public storefront.
 *
 * A guest's only way back to an order is its `/s/<slug>/o/<token>` link. This
 * keeps the last few of those on the device, per store, so the store page can
 * point back at them. Each entry is the order token, the bill number and when
 * the order was placed: no name, phone, address, amount or payment reference.
 *
 * Pure parse / serialise helpers plus two best-effort localStorage wrappers
 * (same pattern as the saved cart in lib/storefront-order.ts): storage that is
 * blocked or full simply means nothing is remembered.
 */

/** Entries older than this are dropped on read. */
export const RECENT_ORDER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Most orders remembered per store. */
export const RECENT_ORDER_LIMIT = 3;

export type RecentOrder = {
  token: string;
  billNumber: string;
  /** ms epoch the order was placed. */
  createdAt: number;
};

/** localStorage key for one store's remembered orders. */
export function recentOrdersStorageKey(slug: string): string {
  return `awz-orders:${slug}`;
}

/** Stored JSON → fresh entries, newest first. Malformed or stale data → []. */
export function parseRecentOrders(raw: string | null, now: number): RecentOrder[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!v || typeof v !== "object") return [];
  const o = v as { v?: unknown; orders?: unknown };
  if (o.v !== 1 || !Array.isArray(o.orders)) return [];
  const out: RecentOrder[] = [];
  for (const entry of o.orders) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.token !== "string" || !e.token || typeof e.billNumber !== "string" || !e.billNumber) continue;
    if (typeof e.createdAt !== "number" || !Number.isFinite(e.createdAt)) continue;
    // A createdAt in the future (clock change) counts as fresh, not as forever.
    const age = now - e.createdAt;
    if (age > RECENT_ORDER_TTL_MS || age < -RECENT_ORDER_TTL_MS) continue;
    if (out.some((x) => x.token === e.token)) continue;
    out.push({ token: e.token, billNumber: e.billNumber, createdAt: e.createdAt });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT_ORDER_LIMIT);
}

/** `orders` plus `order` (replacing an entry with the same token), newest first, capped. */
export function withRecentOrder(orders: readonly RecentOrder[], order: RecentOrder): RecentOrder[] {
  return [order, ...orders.filter((o) => o.token !== order.token)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_ORDER_LIMIT);
}

export function serializeRecentOrders(orders: readonly RecentOrder[]): string {
  return JSON.stringify({ v: 1, orders });
}

/** This device's remembered orders for a store; [] when there are none or storage is blocked. */
export function readRecentOrders(slug: string): RecentOrder[] {
  try {
    return parseRecentOrders(window.localStorage.getItem(recentOrdersStorageKey(slug)), Date.now());
  } catch {
    return [];
  }
}

/** Remembers one order on this device. Best-effort: a blocked or full storage is ignored. */
export function rememberRecentOrder(slug: string, order: RecentOrder): void {
  try {
    const key = recentOrdersStorageKey(slug);
    const now = Date.now();
    const next = parseRecentOrders(
      serializeRecentOrders(withRecentOrder(parseRecentOrders(window.localStorage.getItem(key), now), order)),
      now,
    );
    if (next.length > 0) window.localStorage.setItem(key, serializeRecentOrders(next));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — the order link still works, it just isn't remembered */
  }
}
