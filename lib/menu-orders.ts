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
 *   - No cut-off and no drop row lock: only `isAvailable` items of a vendor
 *     with `VendorSettings.acceptMenuOrders` can be ordered. Items the seller
 *     tracks stock for (lib/inventory.ts) are row-locked (`FOR UPDATE`, id
 *     order) inside the transaction, and a line that needs more than is left is
 *     refused with `out_of_stock`. A free gift that wouldn't fit is dropped.
 *     Untracked items take no lock.
 *   - An item with sizes or colours (lib/item-variants.ts) is ordered by
 *     variant: each line names one (`size_required` otherwise), is priced and
 *     named from it, and tracked variants are locked and checked like items.
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
import { deliveryFields } from "@/lib/delivery-address";
import { deliveryFeeFor, parseDeliveryAreas } from "@/lib/delivery-areas";
import { bumpOrderSignal } from "@/lib/drops-signal";
import { findMenuSlot, parseMenuSlots, type MenuSlot } from "@/lib/menu-slots";
import { firstShortfall } from "@/lib/inventory";
import {
  lockTrackedMenuItems,
  lockTrackedVariants,
  stockLeftByMenuItem,
  stockLeftByVariant,
} from "@/lib/inventory-server";
import { cartLineKey, variantLineName, variantPricePaise } from "@/lib/item-variants";
import { applyOffers, giftLineName, withGiftsThatFit } from "@/lib/offers";
import { loadResolvedOffers } from "@/lib/offers-server";
import type { OrderChannel } from "@/lib/order-channel";
import { effectivePlan, isBillingLocked } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { notifyVendorInBackground, newOrderPayload } from "@/lib/push";
import { alertsAtPlacement } from "@/lib/storefront-online-paid";
import { generateReceiptToken } from "@/lib/receipt-data";

export type MenuOrderSettings = {
  acceptMenuOrders: boolean;
  acceptPayOnDelivery: boolean;
  menuFulfilmentMode: FulfilmentMode;
  menuDeliveryFeePaise: number;
  /** VendorSettings.menuSlots, raw JSON (lib/menu-slots.ts). Omitted = no slots. */
  menuSlots?: unknown;
  /** VendorSettings.deliveryAreas, raw JSON (lib/delivery-areas.ts). Omitted = anywhere. */
  deliveryAreas?: unknown;
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
  items: MenuLine[];
  customerName: string;
  customerPhone: string; // E.164, already validated
  fulfilmentType: FulfilmentType;
  deliveryAddress?: string | null;
  /** Address parts beside the line (lib/delivery-address.ts); older checkouts send none. */
  deliveryLocality?: string | null;
  deliveryLandmark?: string | null;
  deliveryPincode?: string | null;
  /** Start of the picked slot (lib/menu-slots.ts); required when the store has slots. */
  slotStart?: string | null;
  notes?: string | null;
  paymentMethod: "UPI" | "CASH";
  customerId?: string | null;
  /** lib/order-channel.ts; decided by the route from the request. */
  orderChannel?: OrderChannel | null;
  /** The store takes Razorpay: a UPI order alerts the seller once paid (lib/storefront-online-paid.ts). */
  takesOnlinePayment?: boolean;
  now?: Date;
};

export type PlaceMenuOrderError =
  | { code: "menu_orders_disabled" }
  | { code: "menu_paused_for_drop" }
  | { code: "item_not_found"; menuItemId: string; variantId?: string }
  /** The item has sizes or colours and the line named none (lib/item-variants.ts rule 2). */
  | { code: "size_required"; menuItemId: string }
  /** A tracked product (or variant) has fewer left than the line asks for (lib/inventory.ts rule 4). */
  | { code: "out_of_stock"; menuItemId: string; variantId?: string; remaining: number }
  | { code: "fulfilment_unavailable" }
  | { code: "address_required" }
  | { code: "outside_delivery_area" }
  | { code: "slot_required" }
  | { code: "slot_unavailable" }
  | { code: "pay_on_delivery_disabled" }
  | { code: "monthly_txn_cap_reached" }
  | { code: "orders_paused" };

export type PlacedMenuOrder = {
  id: string;
  billNumber: string;
  orderToken: string;
  subtotalPaise: number;
  discountPaise: number;
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

/** One line of a menu order: an item, or one of its variants (lib/item-variants.ts). */
export type MenuLine = { menuItemId: string; variantId?: string | null; qty: number };

/** Merge duplicate lines for the same menu item and variant. */
export function mergeMenuLines(items: readonly MenuLine[]) {
  const merged = new Map<string, { menuItemId: string; variantId: string | null; qty: number }>();
  for (const i of items) {
    const key = cartLineKey(i.menuItemId, i.variantId);
    merged.set(key, { menuItemId: i.menuItemId, variantId: i.variantId ?? null, qty: (merged.get(key)?.qty ?? 0) + i.qty });
  }
  return Array.from(merged.values());
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
  const delivery = deliveryFields(input);
  if (input.fulfilmentType === "DELIVERY" && !delivery.deliveryAddress) {
    return { ok: false, error: { code: "address_required" } };
  }
  // The store's delivery areas set the fee, and a locality outside them is refused.
  const areaFee = deliveryFeeFor(
    parseDeliveryAreas(settings.deliveryAreas),
    input.deliveryLocality,
    settings.menuDeliveryFeePaise,
  );
  if (input.fulfilmentType === "DELIVERY" && !areaFee.ok) {
    return { ok: false, error: { code: "outside_delivery_area" } };
  }
  // "When": with slots configured the buyer must pick one that is still offered.
  const slotRules = parseMenuSlots(settings.menuSlots);
  let slot: MenuSlot | null = null;
  if (slotRules.length > 0) {
    if (!input.slotStart) return { ok: false, error: { code: "slot_required" } };
    slot = findMenuSlot(slotRules, input.slotStart, now);
    if (!slot) return { ok: false, error: { code: "slot_unavailable" } };
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
        select: {
          id: true,
          name: true,
          priceInPaise: true,
          variants: { select: { id: true, label: true, priceInPaise: true, isAvailable: true } },
        },
      });
      const byId = new Map(menuItems.map((m) => [m.id, m]));
      // Each line priced and named from its item, or from its variant (lib/item-variants.ts).
      const priced = lines.map((l) => {
        const item = byId.get(l.menuItemId);
        if (!item) throw new MenuOrderRejected({ code: "item_not_found", menuItemId: l.menuItemId });
        const key = cartLineKey(l.menuItemId, l.variantId);
        if (item.variants.length === 0) {
          if (l.variantId) {
            throw new MenuOrderRejected({ code: "item_not_found", menuItemId: item.id, variantId: l.variantId });
          }
          return { key, item, variantId: null, name: item.name, priceInPaise: item.priceInPaise, qty: l.qty };
        }
        if (!l.variantId) throw new MenuOrderRejected({ code: "size_required", menuItemId: item.id });
        const variant = item.variants.find((v) => v.id === l.variantId && v.isAvailable);
        if (!variant) {
          throw new MenuOrderRejected({ code: "item_not_found", menuItemId: item.id, variantId: l.variantId });
        }
        return {
          key,
          item,
          variantId: variant.id,
          name: variantLineName(item.name, variant.label),
          priceInPaise: variantPricePaise(item.priceInPaise, variant),
          qty: l.qty,
        };
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

      // Same rule as drops: offers are priced server-side from this vendor's rows.
      const offerRules = await loadResolvedOffers(tx, vendorId, { channel: "MENU", now });

      // Stock (lib/inventory.ts rule 4): lock the tracked products behind the
      // lines and any gift, in id order, then refuse a line that needs more than
      // is left. Untracked items are not locked and always pass.
      // Items first, then variants: every order takes its locks in the same order.
      const giftIds = offerRules.flatMap((o) => (o.freeItem ? [o.freeItem.menuItemId] : []));
      const plain = priced.filter((p) => p.variantId === null);
      const tracked = await lockTrackedMenuItems(tx, vendorId, [...plain.map((p) => p.item.id), ...giftIds]);
      const sized = priced.flatMap((p) => (p.variantId ? [{ ...p, variantId: p.variantId }] : []));
      const trackedVariants = await lockTrackedVariants(
        tx,
        vendorId,
        sized.map((p) => p.variantId),
      );
      const [left, variantLeft] = await Promise.all([
        stockLeftByMenuItem(tx, vendorId, tracked, now),
        stockLeftByVariant(tx, vendorId, trackedVariants, now),
      ]);
      const need = new Map(plain.map((p) => [p.item.id, p.qty]));
      const shortfall = firstShortfall(need, left);
      if (shortfall) throw new MenuOrderRejected({ code: "out_of_stock", ...shortfall });
      // firstShortfall is keyed by whatever the map holds; here it is the variant id.
      const variantShortfall = firstShortfall(new Map(sized.map((p) => [p.variantId, p.qty])), variantLeft);
      if (variantShortfall) {
        const variantId = variantShortfall.menuItemId;
        throw new MenuOrderRejected({
          code: "out_of_stock",
          menuItemId: sized.find((p) => p.variantId === variantId)?.item.id ?? variantId,
          variantId,
          remaining: variantShortfall.remaining,
        });
      }
      // No gift with sizes yet (lib/item-variants.ts rule 5): the buyer would have to pick one.
      const sizedGifts =
        giftIds.length === 0
          ? new Set<string>()
          : new Set(
              (
                await tx.itemVariant.findMany({
                  where: { vendorId, menuItemId: { in: giftIds } },
                  select: { menuItemId: true },
                })
              ).map((v) => v.menuItemId),
            );
      // A gift leaves the shelf too: an offer whose gift doesn't fit after the paid lines is skipped.
      const offers = withGiftsThatFit(offerRules, (menuItemId, qty) => {
        if (sizedGifts.has(menuItemId)) return false;
        const l = left.get(menuItemId);
        return l === undefined || (need.get(menuItemId) ?? 0) + qty <= l;
      });
      const offered = applyOffers(
        priced.map((p) => ({
          key: p.key,
          menuItemId: p.item.id,
          priceInPaise: p.priceInPaise,
          qty: p.qty,
        })),
        offers,
      );
      const discountByLine = new Map(offered.lines.map((l) => [l.key, l.discountPaise]));
      const appliedOffer = offered.applied;
      const discountPaise = offered.discountTotalPaise;

      const deliveryFeePaise = input.fulfilmentType === "DELIVERY" && areaFee.ok ? areaFee.feePaise : 0;
      const { subtotalPaise, totalPaise } = computeOrderTotals(
        priced.map((p) => ({ priceInPaise: p.priceInPaise, qty: p.qty })),
        deliveryFeePaise,
        discountPaise,
      );

      const billNumber = await nextBillNumber(tx, vendorId, now);
      const orderToken = generateOrderToken();

      const created = await tx.transaction.create({
        data: {
          vendorId,
          billNumber,
          subtotalPaise,
          discountPaise,
          offerId: appliedOffer?.offerId ?? null,
          offerName: appliedOffer?.name ?? null,
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
          ...(input.fulfilmentType === "DELIVERY" ? delivery : {}),
          fulfilAt: slot?.start ?? null,
          fulfilUntil: slot?.end ?? null,
          orderToken,
          // The rider's "Delivered" link (app/d/[token]); deliveries only.
          riderToken: input.fulfilmentType === "DELIVERY" ? generateOrderToken() : null,
          customerId: input.customerId ?? null,
          orderChannel: input.orderChannel ?? null,
          orderItems: {
            create: [
              ...priced.map((p) => ({
                menuItemId: p.item.id,
                variantId: p.variantId,
                name: p.name, // snapshot ("Cotton kurti – M" for a variant)
                priceInPaise: p.priceInPaise,
                qty: p.qty,
                totalPaise: p.priceInPaise * p.qty,
                discountPaise: discountByLine.get(p.key) ?? 0,
              })),
              // A free-item offer's gift: ₹0, outside every total (lib/offers.ts rule 6).
              ...(offered.gift
                ? [
                    {
                      menuItemId: offered.gift.menuItemId,
                      name: giftLineName(offered.gift.name),
                      priceInPaise: 0,
                      qty: offered.gift.qty,
                      totalPaise: 0,
                      discountPaise: 0,
                      isGift: true,
                    },
                  ]
                : []),
            ],
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
        discountPaise,
        deliveryFeePaise,
        totalPaise,
        paymentMethod: created.paymentMethod,
      } satisfies PlacedMenuOrder;
    });

    void bumpOrderSignal(vendorId);
    if (alertsAtPlacement(input.paymentMethod, input.takesOnlinePayment ?? false)) {
      notifyVendorInBackground(
        vendorId,
        newOrderPayload({
          billNumber: order.billNumber,
          totalPaise: order.totalPaise,
          itemCount: lines.reduce((n, l) => n + l.qty, 0),
          dropId: null,
        }),
      );
    }
    return { ok: true, order };
  } catch (err) {
    if (err instanceof MenuOrderRejected) return { ok: false, error: err.error };
    throw err;
  }
}
