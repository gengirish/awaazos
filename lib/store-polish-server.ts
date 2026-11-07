import type { StaffRole } from "@prisma/client";

import { storePolishNudge, type StorePolishNudge } from "@/lib/orders-banner";
import { prisma } from "@/lib/prisma";

/**
 * The orders board's one-time "store still looks unfinished" nudge
 * (`storePolishNudge`), for an OWNER of a real, published store: test-named
 * items buyers can see, else no tagline. A private store has no buyers to see
 * either, and its setup checklist comes first. Read on page render only.
 */
export async function loadStorePolishNudge(
  vendor: { id: string; isDemo: boolean },
  role: StaffRole,
  store: { published: boolean; tagline: string | null },
): Promise<StorePolishNudge | null> {
  if (role !== "OWNER" || vendor.isDemo || !store.published) return null;
  const items = await prisma.menuItem.findMany({
    where: { vendorId: vendor.id, isAvailable: true, showOnline: true },
    select: { name: true },
    orderBy: { sortOrder: "asc" },
    take: 200,
  });
  return storePolishNudge({ tagline: store.tagline, itemNames: items.map((i) => i.name) });
}
