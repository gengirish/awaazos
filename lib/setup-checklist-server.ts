import type { StaffRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { checklistForRole, setupChecklist, type ChecklistItem } from "@/lib/settings-overview";

// Server only (Prisma): import it from server components and route handlers.

/** Props of `<SetupChecklistCard>` (components/setup/SetupChecklistCard.tsx). */
export type SetupChecklistData = {
  /** Steps still open that this viewer can act on. Empty → the card renders nothing. */
  items: ChecklistItem[];
  /** The published store, for the link with Copy / Share. Null while unpublished. */
  store: { slug: string; name: string } | null;
};

type KnownSettings = {
  publishStorefront: boolean;
  acceptPayOnDelivery: boolean;
  acceptMenuOrders: boolean;
};

export type SetupChecklistInput = {
  /** `ctx.vendor` from `requireVendorRole`. */
  vendor: { id: string; slug: string; name: string; upiId: string | null };
  /** `ctx.staff.role`. */
  role: StaffRole;
  /** Values the page has already read, so they are not read twice. */
  known?: {
    /** The vendor's settings row (null when it has none). */
    settings?: KnownSettings | null;
    /** `MenuItem` rows with `isAvailable: true`. */
    availableItemCount?: number;
  };
};

/**
 * The "start taking online orders" checklist for one page render:
 *
 *   const setup = await loadSetupChecklist({ vendor: ctx.vendor, role: ctx.staff.role });
 *   <SetupChecklistCard {...setup} />
 *
 * Read once per page load, in one batch, and only for staff who can act on a
 * step (every step needs MANAGER or OWNER, so a cashier costs no query). No
 * timer and nothing cached: the rule is the pure `setupChecklist()`.
 */
export async function loadSetupChecklist({ vendor, role, known }: SetupChecklistInput): Promise<SetupChecklistData> {
  if (role === "CASHIER") return { items: [], store: null };

  const [settings, availableItemCount, dropCount] = await Promise.all([
    known?.settings !== undefined
      ? known.settings
      : prisma.vendorSettings.findUnique({
          where: { vendorId: vendor.id },
          select: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true },
        }),
    known?.availableItemCount ?? prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true } }),
    prisma.drop.count({ where: { vendorId: vendor.id } }),
  ]);

  const publishStorefront = settings?.publishStorefront ?? false;
  const items = checklistForRole(
    setupChecklist({
      availableItemCount,
      publishStorefront,
      upiId: vendor.upiId,
      acceptPayOnDelivery: settings?.acceptPayOnDelivery ?? true,
      acceptMenuOrders: settings?.acceptMenuOrders ?? false,
      dropCount,
    }),
    role,
  );

  return { items, store: publishStorefront ? { slug: vendor.slug, name: vendor.name } : null };
}
