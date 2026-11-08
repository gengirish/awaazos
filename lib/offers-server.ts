import type { Prisma, PrismaClient } from "@prisma/client";

import {
  resolveOffers,
  type OfferChannel,
  type OfferMenuItemRef,
  type OfferRule,
  type ResolvedOffer,
} from "@/lib/offers";
import { offerDatesToDays } from "@/lib/zod-offers";

/**
 * Server-side half of offers (pure half: lib/offers.ts).
 *
 * `loadResolvedOffers` is the one place an order path or a page asks "which
 * offers apply here, right now?". It is vendor-scoped, costs one small query
 * when the vendor has no active offers, and never schedules anything.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const OFFER_RULE_SELECT = {
  id: true,
  name: true,
  description: true,
  eligibility: true,
  eligibleItemIds: true,
  eligibleTag: true,
  minQty: true,
  requiredTag: true,
  requiredTagQty: true,
  discountType: true,
  percentBps: true,
  freeItemId: true,
  freeItemQty: true,
  onMenuOrders: true,
  onDrops: true,
  onPos: true,
  dropIds: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
} satisfies Prisma.OfferSelect;

const CHANNEL_WHERE: Record<OfferChannel, Prisma.OfferWhereInput> = {
  MENU: { onMenuOrders: true },
  DROP: { onDrops: true },
  POS: { onPos: true },
};

export type OfferSource = { rules: OfferRule[]; menuItems: OfferMenuItemRef[] };

/**
 * This vendor's active offers on any of `channels`, before the date and drop
 * checks (`resolveOffers` does those). The storefront page asks for MENU and
 * DROP at once and resolves each section from the one result.
 */
export async function loadOfferRules(db: Db, vendorId: string, channels: OfferChannel[]): Promise<OfferSource> {
  const rules: OfferRule[] = await db.offer.findMany({
    where: { vendorId, isActive: true, OR: channels.map((c) => CHANNEL_WHERE[c]) },
    select: OFFER_RULE_SELECT,
  });
  if (rules.length === 0) return { rules, menuItems: [] };
  const needsTags = rules.some((r) => r.eligibility === "TAG" || (r.requiredTag && r.requiredTagQty > 0));
  // A gift needs its name and price; any availability, so a seller can give
  // away something they don't sell on its own.
  const giftIds = rules.flatMap((r) => (r.discountType === "FREE_ITEM" && r.freeItemId ? [r.freeItemId] : []));
  if (!needsTags && giftIds.length === 0) return { rules, menuItems: [] };
  const menuItems: OfferMenuItemRef[] = await db.menuItem.findMany({
    where: needsTags ? { vendorId } : { vendorId, id: { in: giftIds } },
    select: { id: true, tags: true, name: true, priceInPaise: true },
  });
  return { rules, menuItems };
}

/** This vendor's offers that are live on `channel` right now, tags resolved to item ids. */
export async function loadResolvedOffers(
  db: Db,
  vendorId: string,
  ctx: { channel: OfferChannel; dropId?: string | null; now?: Date },
): Promise<ResolvedOffer[]> {
  const { rules, menuItems } = await loadOfferRules(db, vendorId, [ctx.channel]);
  return rules.length ? resolveOffers(rules, menuItems, ctx) : [];
}

/** An offer as the Settings page and its API see it. */
export function offerToDto(o: OfferRule) {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    eligibility: o.eligibility,
    eligibleItemIds: o.eligibleItemIds,
    eligibleTag: o.eligibleTag,
    minQty: o.minQty,
    requiredTag: o.requiredTag,
    requiredTagQty: o.requiredTagQty,
    discountType: o.discountType,
    percentBps: o.percentBps,
    freeItemId: o.freeItemId,
    freeItemQty: o.freeItemQty,
    onMenuOrders: o.onMenuOrders,
    onDrops: o.onDrops,
    onPos: o.onPos,
    dropIds: o.dropIds,
    isActive: o.isActive,
    ...offerDatesToDays(o),
  };
}

export type OfferDto = ReturnType<typeof offerToDto>;

/**
 * Ids in an offer payload that are not this vendor's. A foreign id and a
 * made-up one get the same answer, so the check leaks nothing.
 */
export async function unknownOfferRefs(
  db: Db,
  vendorId: string,
  refs: { eligibleItemIds: string[]; dropIds: string[]; freeItemId?: string | null },
): Promise<"unknown_items" | "unknown_drops" | "unknown_free_item" | null> {
  if (refs.eligibleItemIds.length) {
    const n = await db.menuItem.count({ where: { vendorId, id: { in: refs.eligibleItemIds } } });
    if (n !== refs.eligibleItemIds.length) return "unknown_items";
  }
  if (refs.freeItemId) {
    const n = await db.menuItem.count({ where: { vendorId, id: refs.freeItemId } });
    if (n !== 1) return "unknown_free_item";
  }
  if (refs.dropIds.length) {
    const n = await db.drop.count({ where: { vendorId, id: { in: refs.dropIds } } });
    if (n !== refs.dropIds.length) return "unknown_drops";
  }
  return null;
}
