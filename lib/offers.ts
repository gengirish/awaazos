/**
 * Offers — quantity-based "plan" discounts ("Weekly Plan: 4+ quiches incl. 1
 * paneer → 10% off"). The pricing rules live here and nowhere else.
 *
 * Pure and client-safe: the server prices every order with `applyOffers`, and
 * the storefront and POS carts call the same function for their preview, so a
 * preview can only disagree with the bill when the offers themselves changed.
 *
 * Two kinds of offer, told apart by their rule (`isSaleOffer`):
 *
 *   - A **sale** needs no quantity: `minQty` 1 and no "at least N of tag X".
 *     It prices each item on its own, so the storefront can show the item's
 *     sale price before it is in the cart (`salePriceFor`) and that is exactly
 *     what the buyer pays: `qty × (price − floor(price × bps / 10 000))`. An item
 *     covered by several sales takes the deepest; different items may come from
 *     different sales in one order.
 *   - A **plan** needs a quantity ("4+ quiches incl. 1 paneer").
 *   - A **free-item plan** (`discountType` FREE_ITEM) gives one catalogue item
 *     the seller picked ("4+ items → free Evil Eye Bracelet") instead of a
 *     percentage. It is always a plan, even at a minimum of 1.
 *
 * Rules:
 *
 *   1. **Plans never stack, with each other or with sales.** The cart gets
 *      either its sale prices or the one plan with the largest discount,
 *      whichever saves more; a tie keeps the sale prices the buyer was shown.
 *      Between plans, ties go to the higher `minQty`, then to the older offer.
 *      When a plan replaces sale prices the cards showed, `setAsideSales` says
 *      which, so the cart can explain why its line prices went back up.
 *   2. **Only eligible lines are discounted.** A cart that mixes quiches with a
 *      Bhel Puri gets the percentage off the quiches alone. Delivery fees are
 *      never discounted.
 *   3. **The "at least N of tag X" units are counted among eligible lines.** A
 *      paneer item outside the offer does not unlock it.
 *   4. **Paise, rounded down.** A plan takes `floor(eligibleSubtotal × bps / 10 000)`
 *      (same direction as tax), split across the eligible lines by largest
 *      remainder so the per-line shares sum to it exactly. A sale rounds down
 *      per unit, so the price on the item card times the quantity is the bill.
 *   5. **No timers.** `startsAt` / `endsAt` are compared with `now` on every
 *      read (`offerIsLive`); nothing is written when a date passes.
 *   6. **A gift is not a discount.** It competes with the other plans and with
 *      sales at its catalogue value (price × qty), but when it wins nothing is
 *      taken off: the order gets one extra line at ₹0 (`OffersResult.gift`,
 *      stored as an `OrderItem` with `isGift`, named by `giftLineName`). So
 *      subtotal, discount and total are exactly what they would be without it,
 *      and the bill records the offer through `applied` (discount 0). The gift
 *      never counts toward the minimum. Free items are online only: they are
 *      never resolved on the POS channel. On a drop the caller removes an offer
 *      whose gift the drop can't hand out (`withGiftsThatFit`).
 *
 * Tax (counter sales only) is charged on `subtotal − discount`, see
 * lib/pos-totals.ts. A bill reconciles as
 * `subtotal − discount + delivery fee + tax = total`.
 *
 * Out of scope, by design: coupon codes, per-customer limits, fixed bundle
 * prices, "cheapest one free", a buyer choosing the gift, stacking a plan on
 * sales, recurring subscriptions.
 */

import { formatINR } from "@/lib/currency";

export type OfferChannel = "MENU" | "DROP" | "POS";

export type OfferEligibilityKind = "ALL" | "ITEMS" | "TAG";

/** An `Offer` row, as stored. Structural, so this file never imports Prisma. */
export type OfferRule = {
  id: string;
  name: string;
  description: string | null;
  eligibility: OfferEligibilityKind;
  eligibleItemIds: string[];
  eligibleTag: string | null;
  minQty: number;
  requiredTag: string | null;
  requiredTagQty: number;
  discountType: "PERCENT" | "FIXED_AMOUNT" | "BUNDLE_PRICE" | "FREE_ITEM";
  percentBps: number;
  freeItemId: string | null;
  freeItemQty: number;
  onMenuOrders: boolean;
  onDrops: boolean;
  onPos: boolean;
  dropIds: string[];
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};

/**
 * An offer with its tags resolved to menu item ids. This is what the engine
 * runs on and what a buyer's browser receives: ids and display labels only.
 */
export type ResolvedOffer = {
  id: string;
  name: string;
  description: string | null;
  minQty: number;
  percentBps: number;
  /** null = every item. */
  eligibleItemIds: string[] | null;
  /** The eligible tag ("quiche"), for cart copy. null when not tag-based. */
  eligibleLabel: string | null;
  /** Items that count toward `requiredQty`. null = no such condition. */
  requiredItemIds: string[] | null;
  requiredQty: number;
  requiredLabel: string | null;
  /** A free-item plan's gift (`percentBps` is then 0). null = a percentage offer. */
  freeItem: OfferFreeItem | null;
};

export type OfferFreeItem = {
  menuItemId: string;
  name: string;
  qty: number;
  /** One unit's catalogue price: what the gift is worth against other offers. */
  unitPaise: number;
};

export type OfferLine = {
  /** Caller's handle for the line (drop item id, menu item id, cart index). */
  key: string;
  menuItemId: string | null;
  priceInPaise: number;
  qty: number;
};

export type PricedLine = OfferLine & {
  totalPaise: number;
  /** This line's share of the discount; 0 for a line outside the offer. */
  discountPaise: number;
};

export type AppliedDiscount = {
  offerId: string;
  name: string;
  percentBps: number;
  discountPaise: number;
};

export type OfferNudge = {
  offerId: string;
  name: string;
  percentBps: number;
  /** Eligible units still to add (already includes `missingRequiredQty`). */
  missingQty: number;
  /** Of those, how many must be the required kind. */
  missingRequiredQty: number;
  eligibleLabel: string | null;
  requiredLabel: string | null;
  /** Set for a free-item plan: what the buyer would get. */
  freeItem: { name: string; qty: number } | null;
};

/** The gift line a winning free-item plan adds to the order (priced 0). */
export type OfferGift = {
  offerId: string;
  offerName: string;
  menuItemId: string;
  /** The item's own name; the stored line uses `giftLineName(name)`. */
  name: string;
  qty: number;
  /** Catalogue value of the gift (unit price × qty), for display only. */
  valuePaise: number;
};

export type OffersResult = {
  lines: PricedLine[];
  /** What was applied: one plan, or one entry per sale used (largest first). */
  discounts: AppliedDiscount[];
  /**
   * The one offer a bill records (`Transaction.offerId` / `offerName`): the plan,
   * the single sale, or for several sales the largest one's id and a combined
   * name ("Diwali sale + 1 more"). null when nothing was applied.
   */
  applied: AppliedDiscount | null;
  subtotalPaise: number;
  discountTotalPaise: number;
  /** `subtotalPaise − discountTotalPaise`. Delivery fee and tax are the caller's. */
  totalPaise: number;
  /** The closest better offer the cart has not unlocked yet. */
  nudge: OfferNudge | null;
  /** The free item this order gets, or null. Not part of any total. */
  gift: OfferGift | null;
  /**
   * The sales a winning plan replaced (combined name, what they would have
   * taken off), or null. Display only: the buyer saw these prices on the cards.
   */
  setAsideSales: AppliedDiscount | null;
};

export const OFFER_NAME_MAX = 60;
export const OFFER_DESCRIPTION_MAX = 160;
export const OFFER_TAG_MAX = 40;
/** 1% … 90%. A 100% offer is a giveaway, not a discount. */
export const OFFER_MIN_BPS = 100;
export const OFFER_MAX_BPS = 9_000;
export const OFFER_MAX_QTY = 500;

/** Tags compare trimmed and case-insensitively ("Paneer" = "paneer "). */
export function normaliseTag(tag: string | null | undefined): string {
  return (tag ?? "").trim().toLowerCase();
}

/** "10%", "12.5%". No float formatting: basis points are integers. */
export function formatPercentBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}%`;
}

/** Is this offer on sale right now? Lazy: compared on every read. */
export function offerIsLive(
  offer: Pick<OfferRule, "isActive" | "startsAt" | "endsAt" | "discountType">,
  now: Date = new Date(),
): boolean {
  if (!offer.isActive) return false;
  if (offer.discountType !== "PERCENT" && offer.discountType !== "FREE_ITEM") return false;
  if (offer.startsAt && now.getTime() < offer.startsAt.getTime()) return false;
  if (offer.endsAt && now.getTime() >= offer.endsAt.getTime()) return false;
  return true;
}

function offerOnChannel(
  offer: Pick<OfferRule, "onMenuOrders" | "onDrops" | "onPos" | "dropIds">,
  channel: OfferChannel,
  dropId: string | null | undefined,
): boolean {
  if (channel === "POS") return offer.onPos;
  if (channel === "MENU") return offer.onMenuOrders;
  if (!offer.onDrops) return false;
  return offer.dropIds.length === 0 || (!!dropId && offer.dropIds.includes(dropId));
}

/** At most this many of the gift per order. */
export const OFFER_MAX_FREE_QTY = 10;

/** A catalogue row as `resolveOffers` needs it. Name and price matter only for a gift. */
export type OfferMenuItemRef = {
  id: string;
  tags: readonly string[];
  name?: string;
  priceInPaise?: number;
};

/**
 * The offers that apply on one channel right now, oldest first, with tags
 * turned into item ids. `menuItems` is the vendor's catalogue (id + tags, and
 * name + price for every free-item offer's gift; an offer whose gift is
 * missing is left out, so deleting the item ends the offer).
 */
export function resolveOffers(
  rules: readonly OfferRule[],
  menuItems: readonly OfferMenuItemRef[],
  ctx: { channel: OfferChannel; dropId?: string | null; now?: Date },
): ResolvedOffer[] {
  const now = ctx.now ?? new Date();
  const idsWithTag = (tag: string): string[] =>
    menuItems.filter((m) => m.tags.some((t) => normaliseTag(t) === tag)).map((m) => m.id);

  const out: ResolvedOffer[] = [];
  const live = rules
    .filter((r) => offerIsLive(r, now) && offerOnChannel(r, ctx.channel, ctx.dropId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  for (const r of live) {
    if (r.minQty < 1) continue;
    let freeItem: OfferFreeItem | null = null;
    if (r.discountType === "FREE_ITEM") {
      // Online only: the counter prices its own cart offline (lib/pos-offers.ts).
      if (ctx.channel === "POS") continue;
      const gift = r.freeItemId ? menuItems.find((m) => m.id === r.freeItemId) : undefined;
      const qty = Math.min(Math.max(r.freeItemQty, 1), OFFER_MAX_FREE_QTY);
      if (!gift?.name || gift.priceInPaise === undefined) continue;
      freeItem = { menuItemId: gift.id, name: gift.name, qty, unitPaise: gift.priceInPaise };
    } else if (r.percentBps < 1 || r.percentBps >= 10_000) {
      continue;
    }

    let eligibleItemIds: string[] | null = null;
    let eligibleLabel: string | null = null;
    if (r.eligibility === "ITEMS") {
      eligibleItemIds = [...r.eligibleItemIds];
    } else if (r.eligibility === "TAG") {
      const tag = normaliseTag(r.eligibleTag);
      if (!tag) continue;
      eligibleItemIds = idsWithTag(tag);
      eligibleLabel = tag;
    }

    const requiredTag = normaliseTag(r.requiredTag);
    const hasRequired = requiredTag !== "" && r.requiredTagQty > 0;
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      minQty: r.minQty,
      percentBps: freeItem ? 0 : r.percentBps,
      eligibleItemIds,
      eligibleLabel,
      requiredItemIds: hasRequired ? idsWithTag(requiredTag) : null,
      requiredQty: hasRequired ? r.requiredTagQty : 0,
      requiredLabel: hasRequired ? requiredTag : null,
      freeItem,
    });
  }
  return out;
}

/**
 * Leave out the free-item offers whose gift can't be handed out with this
 * order. On a drop the gift must be one of the drop's items with stock left
 * after the paid lines: `giftFits(menuItemId, qty)` answers that. Menu orders
 * and pages without stock don't need it.
 */
export function withGiftsThatFit(
  offers: readonly ResolvedOffer[],
  giftFits: (menuItemId: string, qty: number) => boolean,
): ResolvedOffer[] {
  return offers.filter((o) => !o.freeItem || giftFits(o.freeItem.menuItemId, o.freeItem.qty));
}

const GIFT_LINE_SUFFIX = " (free gift)";

/** The stored name of a gift line: a snapshot every bill, board and receipt shows as is. */
export function giftLineName(name: string): string {
  return `${name}${GIFT_LINE_SUFFIX}`;
}

/** The item's own name from a gift line's stored name: the inverse of `giftLineName`. */
export function giftBaseName(lineName: string): string {
  return lineName.endsWith(GIFT_LINE_SUFFIX) ? lineName.slice(0, -GIFT_LINE_SUFFIX.length) : lineName;
}

/**
 * Offers as a public page may send them: item ids cut down to the ones that
 * page already shows, and offers nothing on the page can earn left out.
 * Pricing is unchanged, since a cart only ever holds items from `visibleIds`.
 */
export function offersForItems(offers: readonly ResolvedOffer[], visibleIds: Iterable<string>): ResolvedOffer[] {
  const visible = new Set(visibleIds);
  const out: ResolvedOffer[] = [];
  for (const o of offers) {
    const eligibleItemIds = o.eligibleItemIds ? o.eligibleItemIds.filter((id) => visible.has(id)) : null;
    const requiredItemIds = o.requiredItemIds ? o.requiredItemIds.filter((id) => visible.has(id)) : null;
    if (eligibleItemIds && eligibleItemIds.length === 0) continue;
    if (eligibleItemIds === null && visible.size === 0) continue;
    out.push({ ...o, eligibleItemIds, requiredItemIds });
  }
  return out;
}

/** A sale needs no quantity, so one unit already gets it (see the header). A free item is never a sale. */
export function isSaleOffer(
  o: Pick<ResolvedOffer, "minQty" | "requiredQty"> & { freeItem?: OfferFreeItem | null },
): boolean {
  return o.minQty <= 1 && o.requiredQty === 0 && !o.freeItem;
}

function saleCovers(o: ResolvedOffer, menuItemId: string | null): boolean {
  if (o.eligibleItemIds === null) return true;
  return menuItemId !== null && o.eligibleItemIds.includes(menuItemId);
}

/** Paise off one unit at this percentage, rounded down. */
function unitSaleDiscount(priceInPaise: number, bps: number): number {
  return Math.floor((priceInPaise * bps) / 10_000);
}

/** The deepest sale on this item (the older offer on a tie), or null. */
function bestSaleFor(
  offers: readonly ResolvedOffer[],
  menuItemId: string | null,
  priceInPaise: number,
): ResolvedOffer | null {
  let best: ResolvedOffer | null = null;
  for (const o of offers) {
    if (!isSaleOffer(o) || !saleCovers(o, menuItemId)) continue;
    if (unitSaleDiscount(priceInPaise, o.percentBps) <= 0) continue;
    if (!best || o.percentBps > best.percentBps) best = o;
  }
  return best;
}

export type SalePrice = {
  /** What one unit costs on sale. */
  salePricePaise: number;
  offerId: string;
  offerName: string;
  percentBps: number;
};

/**
 * One unit's sale price, for the item card (struck-out price, then this), or
 * null when no sale covers it. `offers` are the ones live on this page;
 * quantity plans never give a card price. Times the quantity, this is what the
 * cart charges, unless a plan saves the buyer more.
 */
export function salePriceFor(
  offers: readonly ResolvedOffer[],
  menuItemId: string | null,
  priceInPaise: number,
): SalePrice | null {
  const o = bestSaleFor(offers, menuItemId, priceInPaise);
  if (!o) return null;
  return {
    salePricePaise: priceInPaise - unitSaleDiscount(priceInPaise, o.percentBps),
    offerId: o.id,
    offerName: o.name,
    percentBps: o.percentBps,
  };
}

/** "Diwali sale", or "Diwali sale + 2 more" when several sales were used, within OFFER_NAME_MAX. */
function combinedSaleName(used: readonly AppliedDiscount[]): string {
  const first = used[0]!.name;
  if (used.length === 1) return first;
  const all = used.map((d) => d.name).join(" + ");
  if (all.length <= OFFER_NAME_MAX) return all;
  const suffix = ` + ${used.length - 1} more`;
  return `${first.slice(0, OFFER_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
}

type SaleEvaluation = { shares: number[]; used: AppliedDiscount[]; discountPaise: number };

function evaluateSales(lines: readonly OfferLine[], offers: readonly ResolvedOffer[]): SaleEvaluation {
  const byOffer = new Map<string, AppliedDiscount>();
  const shares = lines.map((l) => {
    const o = bestSaleFor(offers, l.menuItemId, l.priceInPaise);
    if (!o || l.qty === 0) return 0;
    const share = l.qty * unitSaleDiscount(l.priceInPaise, o.percentBps);
    const entry = byOffer.get(o.id) ?? { offerId: o.id, name: o.name, percentBps: o.percentBps, discountPaise: 0 };
    entry.discountPaise += share;
    byOffer.set(o.id, entry);
    return share;
  });
  const used = [...byOffer.values()].sort(
    (a, b) => b.discountPaise - a.discountPaise || b.percentBps - a.percentBps,
  );
  return { shares, used, discountPaise: shares.reduce((a, b) => a + b, 0) };
}

type Evaluation = {
  offer: ResolvedOffer;
  order: number;
  eligible: boolean[];
  eligibleQty: number;
  requiredQty: number;
  eligibleSubtotalPaise: number;
  discountPaise: number;
  qualifies: boolean;
};

function evaluate(lines: readonly OfferLine[], offer: ResolvedOffer, order: number): Evaluation {
  const eligibleIds = offer.eligibleItemIds ? new Set(offer.eligibleItemIds) : null;
  const requiredIds = offer.requiredItemIds ? new Set(offer.requiredItemIds) : null;
  const eligible: boolean[] = [];
  let eligibleQty = 0;
  let requiredQty = 0;
  let eligibleSubtotalPaise = 0;
  for (const l of lines) {
    const ok = eligibleIds === null || (l.menuItemId !== null && eligibleIds.has(l.menuItemId));
    eligible.push(ok);
    if (!ok) continue;
    eligibleQty += l.qty;
    eligibleSubtotalPaise += l.priceInPaise * l.qty;
    if (requiredIds && l.menuItemId !== null && requiredIds.has(l.menuItemId)) requiredQty += l.qty;
  }
  // What the buyer saves: the percentage, or the gift's catalogue value.
  const discountPaise = offer.freeItem
    ? offer.freeItem.unitPaise * offer.freeItem.qty
    : Math.floor((eligibleSubtotalPaise * offer.percentBps) / 10_000);
  const qualifies = eligibleQty >= offer.minQty && requiredQty >= offer.requiredQty && discountPaise > 0;
  return { offer, order, eligible, eligibleQty, requiredQty, eligibleSubtotalPaise, discountPaise, qualifies };
}

/** Split `discountPaise` over the eligible lines; shares sum to it exactly. */
function allocate(lines: readonly OfferLine[], ev: Evaluation): number[] {
  const shares = lines.map(() => 0);
  const remainders: { index: number; rem: number }[] = [];
  let given = 0;
  lines.forEach((l, index) => {
    if (!ev.eligible[index]) return;
    const raw = l.priceInPaise * l.qty * ev.offer.percentBps;
    shares[index] = Math.floor(raw / 10_000);
    given += shares[index]!;
    remainders.push({ index, rem: raw % 10_000 });
  });
  remainders.sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (let i = 0; given < ev.discountPaise && i < remainders.length; i++, given++) {
    shares[remainders[i]!.index]! += 1;
  }
  return shares;
}

/**
 * `appliedBps`: the deepest percentage the cart already gets, or null.
 * `savedPaise`: what the cart saves now, a gift counted at its value.
 */
function nudgeFor(evals: Evaluation[], appliedBps: number | null, savedPaise: number): OfferNudge | null {
  let best: { ev: Evaluation; missing: number } | null = null;
  for (const ev of evals) {
    if (ev.qualifies || ev.eligibleQty === 0) continue;
    // Not worth mentioning unless it beats what the cart already gets.
    if (ev.offer.freeItem) {
      if (ev.discountPaise <= savedPaise) continue;
    } else if (appliedBps !== null && ev.offer.percentBps <= appliedBps) {
      continue;
    }
    const missing = Math.max(ev.offer.minQty - ev.eligibleQty, ev.offer.requiredQty - ev.requiredQty, 0);
    if (missing === 0) continue;
    if (
      !best ||
      missing < best.missing ||
      (missing === best.missing && ev.offer.percentBps > best.ev.offer.percentBps)
    ) {
      best = { ev, missing };
    }
  }
  if (!best) return null;
  const { ev, missing } = best;
  return {
    offerId: ev.offer.id,
    name: ev.offer.name,
    percentBps: ev.offer.percentBps,
    missingQty: missing,
    missingRequiredQty: Math.max(ev.offer.requiredQty - ev.requiredQty, 0),
    eligibleLabel: ev.offer.eligibleLabel,
    requiredLabel: ev.offer.requiredLabel,
    freeItem: ev.offer.freeItem ? { name: ev.offer.freeItem.name, qty: ev.offer.freeItem.qty } : null,
  };
}

/**
 * Price a cart. `offers` must already be the ones live on this channel
 * (`resolveOffers`); the order of that list is the final tie-break.
 */
export function applyOffers(lines: readonly OfferLine[], offers: readonly ResolvedOffer[]): OffersResult {
  let subtotalPaise = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.priceInPaise) || !Number.isInteger(l.qty) || l.priceInPaise < 0 || l.qty < 0) {
      throw new Error("Offer lines need integer paise and quantities");
    }
    subtotalPaise += l.priceInPaise * l.qty;
  }

  const sales = evaluateSales(lines, offers);
  // Plans only: a sale's percentage is already in `sales`, item by item.
  const evals = offers.map((o, i) => evaluate(lines, o, i)).filter((ev) => !isSaleOffer(ev.offer));
  let applied: Evaluation | null = null;
  for (const ev of evals) {
    if (!ev.qualifies) continue;
    if (
      !applied ||
      ev.discountPaise > applied.discountPaise ||
      (ev.discountPaise === applied.discountPaise && ev.offer.minQty > applied.offer.minQty)
    ) {
      applied = ev;
    }
  }

  // The cart was shown its sale prices: a plan replaces them only by saving more.
  const plan = applied !== null && applied.discountPaise > sales.discountPaise ? applied : null;
  const salesWin = plan === null && sales.discountPaise > 0;

  let shares: number[];
  let discounts: AppliedDiscount[];
  let gift: OfferGift | null = null;
  if (plan?.offer.freeItem) {
    // Rule 6: the gift is an extra ₹0 line, not money off the paid ones.
    const f = plan.offer.freeItem;
    shares = lines.map(() => 0);
    discounts = [{ offerId: plan.offer.id, name: plan.offer.name, percentBps: 0, discountPaise: 0 }];
    gift = {
      offerId: plan.offer.id,
      offerName: plan.offer.name,
      menuItemId: f.menuItemId,
      name: f.name,
      qty: f.qty,
      valuePaise: plan.discountPaise,
    };
  } else if (plan) {
    shares = allocate(lines, plan);
    discounts = [
      { offerId: plan.offer.id, name: plan.offer.name, percentBps: plan.offer.percentBps, discountPaise: plan.discountPaise },
    ];
  } else if (salesWin) {
    shares = sales.shares;
    discounts = sales.used;
  } else {
    shares = lines.map(() => 0);
    discounts = [];
  }

  const discountTotalPaise = shares.reduce((a, b) => a + b, 0);
  const summary: AppliedDiscount | null =
    discounts.length === 0
      ? null
      : {
          offerId: discounts[0]!.offerId,
          name: salesWin ? combinedSaleName(discounts) : discounts[0]!.name,
          percentBps: Math.max(...discounts.map((d) => d.percentBps)),
          discountPaise: discountTotalPaise,
        };
  return {
    lines: lines.map((l, i) => ({ ...l, totalPaise: l.priceInPaise * l.qty, discountPaise: shares[i]! })),
    discounts,
    applied: summary,
    subtotalPaise,
    discountTotalPaise,
    totalPaise: subtotalPaise - discountTotalPaise,
    nudge: nudgeFor(
      evals,
      gift ? null : (summary?.percentBps ?? null),
      gift ? gift.valuePaise : discountTotalPaise,
    ),
    gift,
    setAsideSales:
      plan !== null && sales.discountPaise > 0
        ? {
            offerId: sales.used[0]!.offerId,
            name: combinedSaleName(sales.used),
            percentBps: Math.max(...sales.used.map((d) => d.percentBps)),
            discountPaise: sales.discountPaise,
          }
        : null,
  };
}

// ─── Copy ───────────────────────────────────────────────────────────

function itemsPhrase(qty: number, ...labels: (string | null)[]): string {
  const words = labels.filter(Boolean).join(" ");
  return `${qty} ${words ? `${words} ` : ""}${qty === 1 ? "item" : "items"}`;
}

/** "Weekly Plan: 4+ quiche items incl. 1 paneer → 10% off"; a sale reads "Diwali sale: 10% off quiche items". */
export function offerSummary(o: ResolvedOffer): string {
  if (isSaleOffer(o)) {
    const what = o.eligibleLabel ? ` ${o.eligibleLabel} items` : o.eligibleItemIds === null ? " everything" : "";
    return `${o.name}: ${formatPercentBps(o.percentBps)} off${what}`;
  }
  const need = `${o.minQty}+ ${o.eligibleLabel ? `${o.eligibleLabel} ` : ""}items`;
  const incl = o.requiredQty > 0 && o.requiredLabel ? ` incl. ${o.requiredQty} ${o.requiredLabel}` : "";
  const reward = o.freeItem ? freeItemPhrase(o.freeItem) : `${formatPercentBps(o.percentBps)} off`;
  return `${o.name}: ${need}${incl} → ${reward}`;
}

/** "free Evil Eye Bracelet", "2 free Evil Eye Bracelet". */
export function freeItemPhrase(f: { name: string; qty: number }): string {
  return f.qty > 1 ? `${f.qty} free ${f.name}` : `free ${f.name}`;
}

/** "Add 1 more quiche item to unlock 10% off (Weekly Plan)"; a gift reads "… to get a free Evil Eye Bracelet (Festive gift)". */
export function offerNudgeText(n: OfferNudge): string {
  const unlock = n.freeItem
    ? `to get ${n.freeItem.qty > 1 ? "" : "a "}${freeItemPhrase(n.freeItem)} (${n.name})`
    : `to unlock ${formatPercentBps(n.percentBps)} off (${n.name})`;
  if (n.missingRequiredQty > 0 && n.missingRequiredQty >= n.missingQty) {
    return `Add ${itemsPhrase(n.missingRequiredQty, n.requiredLabel, n.eligibleLabel)} ${unlock}`;
  }
  if (n.missingRequiredQty > 0) {
    return `Add ${n.missingQty} more ${n.eligibleLabel ? `${n.eligibleLabel} ` : ""}items, including ${n.missingRequiredQty} ${n.requiredLabel ?? "required"}, ${unlock}`;
  }
  return `Add ${n.missingQty} more ${n.eligibleLabel ? `${n.eligibleLabel} ` : ""}${n.missingQty === 1 ? "item" : "items"} ${unlock}`;
}

/** An offer as Settings lists it: the stored rule, not yet resolved. */
export type OfferRuleSummaryInput = Pick<
  OfferRule,
  "eligibility" | "eligibleItemIds" | "eligibleTag" | "minQty" | "requiredTag" | "requiredTagQty" | "discountType" | "percentBps" | "freeItemQty"
>;

/**
 * The seller's one-line summary of an offer in Settings → Offers:
 * "10% off 4 or more items", "10% off 4 or more items tagged "quiche", including 1 tagged "paneer"",
 * "10% off 4 or more of 3 chosen items", "Free Evil Eye Bracelet with 4 or more items",
 * "Sale · 35% off all items". `giftName` is the free item's current name, or null when it is gone.
 */
export function offerRuleSummary(o: OfferRuleSummaryInput, giftName: string | null = null): string {
  const chosen = o.eligibleItemIds.length;
  const chosenLabel = `${chosen} chosen ${chosen === 1 ? "item" : "items"}`;
  // "4 or more …": the units that count toward the minimum.
  const counted =
    o.eligibility === "TAG"
      ? `${o.minQty} or more items tagged "${o.eligibleTag}"`
      : o.eligibility === "ITEMS"
        ? `${o.minQty} or more of ${chosenLabel}`
        : `${o.minQty} or more items`;
  const incl = o.requiredTag && o.requiredTagQty > 0 ? `, including ${o.requiredTagQty} tagged "${o.requiredTag}"` : "";
  if (o.discountType === "FREE_ITEM") {
    const gift = giftName ? freeItemPhrase({ name: giftName, qty: o.freeItemQty }) : "a free item no longer listed";
    return `${gift[0]!.toUpperCase()}${gift.slice(1)} with ${counted}${incl}`;
  }
  // minQty 1 with no "including" condition is a sale (isSaleOffer).
  if (o.minQty <= 1 && !incl) {
    const onSale =
      o.eligibility === "TAG" ? `items tagged "${o.eligibleTag}"` : o.eligibility === "ITEMS" ? chosenLabel : "all items";
    return `Sale · ${formatPercentBps(o.percentBps)} off ${onSale}`;
  }
  return `${formatPercentBps(o.percentBps)} off ${counted}${incl}`;
}

/** The cart's line for a gift it has earned: "Festive gift: free Evil Eye Bracelet added." */
export function offerGiftText(g: OfferGift): string {
  return `${g.offerName}: ${freeItemPhrase(g)} added.`;
}

/**
 * Why the cart's prices are above the sale prices on the cards: "Free Bhel
 * (worth ₹80.00) instead of Diwali sale (₹43.75 off): offers don't combine." A
 * percentage plan reads "Weekly Plan (₹120.00 off) instead of …". null when no sale was set aside.
 */
export function offerSetAsideText(r: Pick<OffersResult, "gift" | "applied" | "setAsideSales">): string | null {
  const sale = r.setAsideSales;
  if (!sale) return null;
  const gift = r.gift ? freeItemPhrase(r.gift) : null;
  const winner = gift
    ? `${gift.charAt(0).toUpperCase()}${gift.slice(1)} (worth ${formatINR(r.gift!.valuePaise)})`
    : r.applied
      ? `${r.applied.name} (${formatINR(r.applied.discountPaise)} off)`
      : null;
  if (!winner) return null;
  return `${winner} instead of ${sale.name} (${formatINR(sale.discountPaise)} off): offers don't combine.`;
}

// ─── Overlapping plans (seller-side warning) ────────────────────────

/** The fields `overlappingOffers` reads: an `OfferDto` fits, days as YYYY-MM-DD. */
export type OfferOverlapInput = {
  id: string;
  name: string;
  isActive: boolean;
  discountType: OfferRule["discountType"];
  eligibility: OfferEligibilityKind;
  eligibleItemIds: string[];
  eligibleTag: string | null;
  minQty: number;
  requiredTagQty: number;
  onMenuOrders: boolean;
  onDrops: boolean;
  onPos: boolean;
  dropIds: string[];
  startsOn: string | null;
  endsOn: string | null;
};

function isPlanRule(o: OfferOverlapInput): boolean {
  return o.discountType === "FREE_ITEM" || o.minQty > 1 || o.requiredTagQty > 0;
}

function sameOrderPossible(a: OfferOverlapInput, b: OfferOverlapInput): boolean {
  const aPos = a.onPos && a.discountType !== "FREE_ITEM";
  const bPos = b.onPos && b.discountType !== "FREE_ITEM";
  const drops =
    a.onDrops &&
    b.onDrops &&
    (a.dropIds.length === 0 || b.dropIds.length === 0 || a.dropIds.some((id) => b.dropIds.includes(id)));
  return (a.onMenuOrders && b.onMenuOrders) || drops || (aPos && bPos);
}

/** Can one item count toward both? Item lists against a tag can't be told apart here, so they count as overlapping. */
function itemsOverlap(a: OfferOverlapInput, b: OfferOverlapInput): boolean {
  if (a.eligibility === "ALL" || b.eligibility === "ALL") return true;
  if (a.eligibility === "TAG" && b.eligibility === "TAG") return normaliseTag(a.eligibleTag) === normaliseTag(b.eligibleTag);
  if (a.eligibility === "ITEMS" && b.eligibility === "ITEMS") return a.eligibleItemIds.some((id) => b.eligibleItemIds.includes(id));
  return true;
}

function datesOverlap(a: OfferOverlapInput, b: OfferOverlapInput): boolean {
  if (a.startsOn && b.endsOn && a.startsOn > b.endsOn) return false;
  if (b.startsOn && a.endsOn && b.startsOn > a.endsOn) return false;
  return true;
}

/**
 * Pairs of switched-on offers, at least one of them a plan, that one order can
 * qualify for. Plans never stack (rule 1), so the seller is told the buyer gets
 * whichever saves more. Two sales are not a pair: each item takes its deepest.
 */
export function overlappingOffers(offers: readonly OfferOverlapInput[]): [OfferOverlapInput, OfferOverlapInput][] {
  const on = offers.filter((o) => o.isActive);
  const pairs: [OfferOverlapInput, OfferOverlapInput][] = [];
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const a = on[i]!;
      const b = on[j]!;
      if (!isPlanRule(a) && !isPlanRule(b)) continue;
      if (sameOrderPossible(a, b) && itemsOverlap(a, b) && datesOverlap(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Label for the discount row on carts, bills and receipts. */
export function discountLabel(offerName: string | null | undefined): string {
  const name = offerName?.trim();
  return name ? `Discount (${name})` : "Discount";
}
