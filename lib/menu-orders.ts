/**
 * "Order from menu" — storefront orders against a vendor's everyday MenuItems,
 * without a Drop. For stalls and shops that want customers to tap and pay on
 * /s/[slug] at any time, rather than run a daily pre-order batch.
 *
 * Deliberately thin over lib/drops.ts: same Transaction shape (source
 * STOREFRONT, orderToken, fulfilment fields) with `dropId = null`, same
 * payment paths (markOrderPaid / cancelOrder keep DailySummary right), same
 * plan-cap rule. What differs:
 *
 *   - No cut-off and no stock caps, so no row lock: only `isAvailable` items
 *     of a vendor with `VendorSettings.acceptMenuOrders` can be ordered.
 *   - Fulfilment mode, delivery fee and pickup note come from VendorSettings
 *     (menuFulfilmentMode / menuDeliveryFeePaise / menuPickupNote).
 *
 * Prices are always re-read from MenuItem; the client never sends a price.
 */

import type { FulfilmentMode, FulfilmentType, PaymentMethod, Plan } from "@prisma/client";

import { PLAN_LIMITS } from "@/lib/constants";
import {
  allowedFulfilmentTypes,
  computeOrderTotals,
  countBillableTxnThisMonth,
  generateOrderToken,
  nextBillNumber,
} from "@/lib/drops";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { effectivePlan, isBillingLocked } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { notifyVendorInBackground, newOrderPayload } from "@/lib/push";
import { generateReceiptToken } from "@/lib/receipt-data";

export type MenuOrderSettings = {
  acceptMenuOrders: boolean;
  acceptPayOnDelivery: boolean;
  menuFulfilmentMode: FulfilmentMode;
  menuDeliveryFeePaise: number;
};

export type PlaceMenuOrderInput = {
  /**
   * Stored plan + raw expiry + trial end; the cap uses `effectivePlan()` and
   * a locked vendor takes no orders (lib/plan.ts). Omitting `planExpiresAt`
   * means "no expiry" and omitting `trialEndsAt` means "no trial" — always
   * pass both from a DB row.
   */
  vendor: { id: string; plan: Plan; planExpiresAt?: Date | null; trialEndsAt?: Date | null };
  settings: MenuOrderSettings;
  items: { menuItemId: string; qty: number }[];
  customerName: string;
  customerPhone: string; // E.164, already validated
  fulfilmentType: FulfilmentType;
  deliveryAddress?: string | null;
  notes?: string | null;
  paymentMethod: "UPI" | "CASH";
  customerId?: string | null;
  now?: Date;
};

export type PlaceMenuOrderError =
  | { code: "menu_orders_disabled" }
  | { code: "menu_paused_for_drop" }
  | { code: "item_not_found"; menuItemId: string }
  | { code: "fulfilment_unavailable" }
  | { code: "address_required" }
  | { code: "pay_on_delivery_disabled" }
  | { code: "monthly_txn_cap_reached" }
  | { code: "orders_paused" };

export type PlacedMenuOrder = {
  id: string;
  billNumber: string;
  orderToken: string;
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
};

export type PlaceMenuOrderResult =
  | { ok: true; order: PlacedMenuOrder }
  | { ok: false; error: PlaceMenuOrderError };

class MenuOrderRejected extends Error {
  constructor(public readonly error: PlaceMenuOrderError) {
    super(error.code);
  }
}

/**
 * True while one of the vendor's drops is taking orders right now and has
 * `showEverydayMenu = false` — the storefront then shows only the drop, and
 * menu orders are refused so a stale cart can't sneak one in. Mirrors
 * effectiveDropStatus(): stored OPEN, past opensAt (if any), before closesAt.
 */
export async function everydayMenuHiddenByDrop(
  db: Pick<typeof prisma, "drop">,
  vendorId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const hiding = await db.drop.findFirst({
    where: {
      vendorId,
      status: "OPEN",
      showEverydayMenu: false,
      closesAt: { gt: now },
      OR: [{ opensAt: null }, { opensAt: { lte: now } }],
    },
    select: { id: true },
  });
  return hiding !== null;
}

/** Merge duplicate lines for the same menu item. */
export function mergeMenuLines(items: { menuItemId: string; qty: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.menuItemId, (merged.get(i.menuItemId) ?? 0) + i.qty);
  return Array.from(merged, ([menuItemId, qty]) => ({ menuItemId, qty }));
}

export async function placeMenuOrder(input: PlaceMenuOrderInput): Promise<PlaceMenuOrderResult> {
  const now = input.now ?? new Date();
  const vendorId = input.vendor.id;
  const { settings } = input;

  if (!settings.acceptMenuOrders) return { ok: false, error: { code: "menu_orders_disabled" } };
  if (input.paymentMethod === "CASH" && !settings.acceptPayOnDelivery) {
    return { ok: false, error: { code: "pay_on_delivery_disabled" } };
  }
  if (!allowedFulfilmentTypes(settings.menuFulfilmentMode).includes(input.fulfilmentType)) {
    return { ok: false, error: { code: "fulfilment_unavailable" } };
  }
  const address = input.deliveryAddress?.trim() || null;
  if (input.fulfilmentType === "DELIVERY" && !address) {
    return { ok: false, error: { code: "address_required" } };
  }

  const lines = mergeMenuLines(input.items);

  if (await everydayMenuHiddenByDrop(prisma, vendorId, now)) {
    return { ok: false, error: { code: "menu_paused_for_drop" } };
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Compound filter = tenant isolation; unavailable items can't be ordered.
      const menuItems = await tx.menuItem.findMany({
        where: { vendorId, isAvailable: true, showOnline: true, id: { in: lines.map((l) => l.menuItemId) } },
        select: { id: true, name: true, priceInPaise: true },
      });
      const byId = new Map(menuItems.map((m) => [m.id, m]));
      const priced = lines.map((l) => {
        const item = byId.get(l.menuItemId);
        if (!item) throw new MenuOrderRejected({ code: "item_not_found", menuItemId: l.menuItemId });
        return { item, qty: l.qty };
      });

      const planFields = {
        plan: input.vendor.plan,
        planExpiresAt: input.vendor.planExpiresAt ?? null,
        trialEndsAt: input.vendor.trialEndsAt ?? null,
      };
      // Trial over and not subscribed: the vendor can't take new orders. The
      // buyer is told the shop is paused, never why.
      if (isBillingLocked(planFields, now)) {
        throw new MenuOrderRejected({ code: "orders_paused" });
      }
      const plan = effectivePlan(planFields, now);
      const cap = PLAN_LIMITS[plan].monthlyTxnCap;
      if (cap !== null && (await countBillableTxnThisMonth(tx, vendorId, now)) >= cap) {
        throw new MenuOrderRejected({ code: "monthly_txn_cap_reached" });
      }

      const deliveryFeePaise = input.fulfilmentType === "DELIVERY" ? settings.menuDeliveryFeePaise : 0;
      const { subtotalPaise, totalPaise } = computeOrderTotals(
        priced.map((p) => ({ priceInPaise: p.item.priceInPaise, qty: p.qty })),
        deliveryFeePaise,
      );

      const billNumber = await nextBillNumber(tx, vendorId, now);
      const orderToken = generateOrderToken();

      const created = await tx.transaction.create({
        data: {
          vendorId,
          billNumber,
          subtotalPaise,
          totalPaise,
          deliveryFeePaise,
          paymentMethod: input.paymentMethod,
          paymentStatus: "PENDING",
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone,
          source: "STOREFRONT",
          notes: input.notes?.trim() || null,
          dropId: null,
          fulfilmentStatus: "PLACED",
          fulfilmentType: input.fulfilmentType,
          deliveryAddress: input.fulfilmentType === "DELIVERY" ? address : null,
          orderToken,
          customerId: input.customerId ?? null,
          orderItems: {
            create: priced.map((p) => ({
              menuItemId: p.item.id,
              name: p.item.name, // snapshot
              priceInPaise: p.item.priceInPaise,
              qty: p.qty,
              totalPaise: p.item.priceInPaise * p.qty,
            })),
          },
        },
      });

      await tx.receipt.create({
        data: {
          transactionId: created.id,
          vendorId,
          receiptNumber: billNumber,
          whatsappSent: false,
          publicToken: generateReceiptToken(),
        },
      });

      return {
        id: created.id,
        billNumber,
        orderToken,
        subtotalPaise,
        deliveryFeePaise,
        totalPaise,
        paymentMethod: created.paymentMethod,
      } satisfies PlacedMenuOrder;
    });

    void bumpOrderSignal(vendorId);
    notifyVendorInBackground(
      vendorId,
      newOrderPayload({
        billNumber: order.billNumber,
        totalPaise: order.totalPaise,
        itemCount: lines.reduce((n, l) => n + l.qty, 0),
        dropId: null,
      }),
    );
    return { ok: true, order };
  } catch (err) {
    if (err instanceof MenuOrderRejected) return { ok: false, error: err.error };
    throw err;
  }
}
