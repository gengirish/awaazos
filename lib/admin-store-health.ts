/**
 * "Is this store actually using AwaazOS?" for the platform admin pages
 * (`/admin/vendors`, `/admin/demo-stores`). Read-only.
 *
 * Deliberately cross-tenant, like lib/admin-vendors.ts: every caller must have
 * passed `requirePlatformRole` first (SUPER_ADMIN for /admin/vendors, ADMIN for
 * demo stores on /admin/demo-stores). Counts and dates only — no
 * buyer, owner or order details leave this file.
 *
 * Three reads for the whole page (not per store), each keyed on the vendor ids
 * already on screen. Computed when the page renders; nothing is stored.
 */
import { DropStatus } from "@prisma/client";

import { istDayStart } from "@/lib/admin-metrics";
import { prisma } from "@/lib/prisma";

export type StoreHealth = {
  /** Newest real sale or order (counter or storefront, any status). Demo sample orders don't count. */
  lastOrderAt: Date | null;
  /** `VendorSettings.publishStorefront`. */
  published: boolean;
  /** Drops past DRAFT whose cut-off is within the last 7 IST days or still ahead. */
  dropsThisWeek: number;
};

const EMPTY: StoreHealth = { lastOrderAt: null, published: false, dropsThisWeek: 0 };

export function healthFor(map: Map<string, StoreHealth>, vendorId: string): StoreHealth {
  return map.get(vendorId) ?? EMPTY;
}

export async function loadStoreHealth(vendorIds: string[], now: Date = new Date()): Promise<Map<string, StoreHealth>> {
  const map = new Map<string, StoreHealth>();
  if (vendorIds.length === 0) return map;

  const weekStart = istDayStart(7, now);
  const [lastOrders, drops, settings] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: vendorIds }, isSample: false },
      _max: { createdAt: true },
    }),
    prisma.drop.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: vendorIds }, status: { not: DropStatus.DRAFT }, closesAt: { gte: weekStart } },
      _count: { _all: true },
    }),
    prisma.vendorSettings.findMany({
      where: { vendorId: { in: vendorIds } },
      select: { vendorId: true, publishStorefront: true },
    }),
  ]);

  const entry = (id: string): StoreHealth => {
    let h = map.get(id);
    if (!h) {
      h = { ...EMPTY };
      map.set(id, h);
    }
    return h;
  };
  for (const row of lastOrders) entry(row.vendorId).lastOrderAt = row._max.createdAt;
  for (const row of drops) entry(row.vendorId).dropsThisWeek = row._count._all;
  for (const row of settings) entry(row.vendorId).published = row.publishStorefront;
  return map;
}

/**
 * "Today", "Yesterday", "5 days ago", counted in IST calendar days so an order
 * at 23:50 IST is "Yesterday" ten minutes later. Null → "No orders yet".
 */
export function describeLastOrder(lastOrderAt: Date | null, now: Date = new Date()): string {
  if (!lastOrderAt) return "No orders yet";
  const today = istDayStart(0, now).getTime();
  const then = istDayStart(0, lastOrderAt).getTime();
  const days = Math.max(0, Math.round((today - then) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
