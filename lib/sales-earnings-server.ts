/**
 * Database side of lib/sales-earnings.ts, for /admin/earnings. Read on page
 * render only. Cross-tenant: the page must have checked the caller's role, and
 * a SALES caller passes their own id as `onlyUserId`.
 *
 * Who earns is the demo-store audit log's "create" row. Stores that signed up
 * by themselves have no such row and earn nobody anything. With no `onlyUserId`,
 * current ADMINs and SUPER_ADMINs are left out: they build stores too, but are
 * not on a share. An intern who has been removed is a USER again and stays in,
 * because their stores keep paying them.
 */
import { prisma } from "@/lib/prisma";
import {
  earningsByMonth,
  storeEarnings,
  type MonthEarnings,
  type SalesCharge,
  type StoreEarnings,
} from "@/lib/sales-earnings";

const ACTOR_PREFIX = "admin:";

export type RepStore = StoreEarnings & { vendorId: string; name: string };

export type RepEarnings = {
  userId: string;
  name: string | null;
  email: string | null;
  storesBuilt: number;
  /** Stores with at least one charge. */
  stores: RepStore[];
  months: MonthEarnings[];
  totalSharePaise: number;
};

export async function loadSalesEarnings(onlyUserId?: string): Promise<RepEarnings[]> {
  const created = await prisma.demoAuditLog.findMany({
    where: {
      action: "create",
      vendorId: { not: null },
      actor: onlyUserId ? `${ACTOR_PREFIX}${onlyUserId}` : { startsWith: ACTOR_PREFIX },
    },
    select: { actor: true, vendorId: true },
  });

  const vendorIdsByUser = new Map<string, string[]>();
  for (const row of created) {
    const userId = row.actor.slice(ACTOR_PREFIX.length);
    vendorIdsByUser.set(userId, [...(vendorIdsByUser.get(userId) ?? []), row.vendorId!]);
  }
  const vendorIds = [...vendorIdsByUser.values()].flat();

  const [events, vendors, users] = await Promise.all([
    prisma.subscriptionEvent.findMany({
      where: { vendorId: { in: vendorIds }, event: "subscription.charged", amountPaise: { gt: 0 } },
      select: { vendorId: true, paymentId: true, amountPaise: true, createdAt: true },
    }),
    prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { id: { in: [...vendorIdsByUser.keys()] } },
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);

  const chargesByVendor = new Map<string, SalesCharge[]>();
  for (const e of events) {
    const charges = chargesByVendor.get(e.vendorId!) ?? [];
    charges.push({ paymentId: e.paymentId, amountPaise: e.amountPaise!, at: e.createdAt });
    chargesByVendor.set(e.vendorId!, charges);
  }
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const reps: RepEarnings[] = [];
  for (const [userId, ids] of vendorIdsByUser) {
    const user = userById.get(userId);
    if (!onlyUserId && (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN")) continue;
    const stores = ids.flatMap((vendorId): RepStore[] => {
      const earned = storeEarnings(chargesByVendor.get(vendorId) ?? []);
      return earned ? [{ ...earned, vendorId, name: vendorName.get(vendorId) ?? "Deleted store" }] : [];
    });
    const lines = stores.flatMap((s) => s.lines);
    reps.push({
      userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      storesBuilt: ids.length,
      stores,
      months: earningsByMonth(lines),
      totalSharePaise: lines.reduce((sum, l) => sum + l.sharePaise, 0),
    });
  }
  return reps.sort((a, b) => b.totalSharePaise - a.totalSharePaise);
}
