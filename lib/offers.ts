/**
 * Offers — quantity-based "plan" discounts ("Weekly Plan: 4+ quiches incl. 1
 * paneer → 10% off"). The pricing rules live here and nowhere else.
 *
 * Pure and client-safe: the server prices every order with `applyOffers`, and
 * the storefront and POS carts call the same function for their preview, so a
 * preview can only disagree with the bill when the offers themselves changed.
 *
 * Rules:
 *
 *   1. **One offer per order, never stacked.** Of the offers a cart qualifies
 *      for, the one with the largest discount wins. Ties go to the higher
 *      `minQty`, then to the older offer.
 *   2. **Only eligible lines are discounted.** A cart that mixes quiches with a
 *      Bhel Puri gets the percentage off the quiches alone. Delivery fees are
 *      never discounted.
 *   3. **The "at least N of tag X" units are counted among eligible lines.** A
 *      paneer item outside the offer does not unlock it.
 *   4. **Paise, rounded down.** `discount = floor(eligibleSubtotal × bps / 10 000)`
 *      (same direction as tax), then split across the eligible lines by largest
 *      remainder so the per-line shares sum to it exactly.
 *   5. **No timers.** `startsAt` / `endsAt` are compared with `now` on every
 *      read (`offerIsLive`); nothing is written when a date passes.
 *
 * Tax (counter sales only) is charged on `subtotal − discount`, see
 * lib/pos-totals.ts. A bill reconciles as
 * `subtotal − discount + delivery fee + tax = total`.
 *
 * Out of scope, by design: coupon codes, per-customer limits, fixed bundle
 * prices, buy-X-get-Y, stacking, recurring subscriptions.
 */

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
  discountType: "PERCENT" | "FIXED_AMOUNT" | "BUNDLE_PRICE";
  percentBps: number;
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
};

export type OffersResult = {
  lines: PricedLine[];
  /** Zero or one entry: offers never stack. */
  discounts: AppliedDiscount[];
  subtotalPaise: number;
  discountTotalPaise: number;
  /** `subtotalPaise − discountTotalPaise`. Delivery fee and tax are the caller's. */
  totalPaise: number;
  /** The closest better offer the cart has not unlocked yet. */
  nudge: OfferNudge | null;
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
  if (offer.discountType !== "PERCENT") return false;
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

/**
 * The offers that apply on one channel right now, oldest first, with tags
 * turned into item ids. `menuItems` is the vendor's catalogue (id + tags).
 */
export function resolveOffers(
  rules: readonly OfferRule[],
  menuItems: readonly { id: string; tags: readonly string[] }[],
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
    if (r.minQty < 1 || r.percentBps < 1 || r.percentBps >= 10_000) continue;

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
      percentBps: r.percentBps,
      eligibleItemIds,
      eligibleLabel,
      requiredItemIds: hasRequired ? idsWithTag(requiredTag) : null,
      requiredQty: hasRequired ? r.requiredTagQty : 0,
      requiredLabel: hasRequired ? requiredTag : null,
    });
  }
  return out;
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
  const discountPaise = Math.floor((eligibleSubtotalPaise * offer.percentBps) / 10_000);
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

function nudgeFor(evals: Evaluation[], applied: Evaluation | null): OfferNudge | null {
  let best: { ev: Evaluation; missing: number } | null = null;
  for (const ev of evals) {
    if (ev.qualifies || ev.eligibleQty === 0) continue;
    // Not worth mentioning unless it beats what the cart already gets.
    if (applied && ev.offer.percentBps <= applied.offer.percentBps) continue;
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

  const evals = offers.map((o, i) => evaluate(lines, o, i));
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

  const shares = applied ? allocate(lines, applied) : lines.map(() => 0);
  const discountTotalPaise = applied?.discountPaise ?? 0;
  return {
    lines: lines.map((l, i) => ({ ...l, totalPaise: l.priceInPaise * l.qty, discountPaise: shares[i]! })),
    discounts: applied
      ? [
          {
            offerId: applied.offer.id,
            name: applied.offer.name,
            percentBps: applied.offer.percentBps,
            discountPaise: discountTotalPaise,
          },
        ]
      : [],
    subtotalPaise,
    discountTotalPaise,
    totalPaise: subtotalPaise - discountTotalPaise,
    nudge: nudgeFor(evals, applied),
  };
}

// ─── Copy ───────────────────────────────────────────────────────────

function itemsPhrase(qty: number, ...labels: (string | null)[]): string {
  const words = labels.filter(Boolean).join(" ");
  return `${qty} ${words ? `${words} ` : ""}${qty === 1 ? "item" : "items"}`;
}

/** "Weekly Plan: 4+ quiche items incl. 1 paneer → 10% off". */
export function offerSummary(o: ResolvedOffer): string {
  const need = `${o.minQty}+ ${o.eligibleLabel ? `${o.eligibleLabel} ` : ""}items`;
  const incl = o.requiredQty > 0 && o.requiredLabel ? ` incl. ${o.requiredQty} ${o.requiredLabel}` : "";
  return `${o.name}: ${need}${incl} → ${formatPercentBps(o.percentBps)} off`;
}

/** "Add 1 more quiche item to unlock 10% off (Weekly Plan)". */
export function offerNudgeText(n: OfferNudge): string {
  const unlock = `to unlock ${formatPercentBps(n.percentBps)} off (${n.name})`;
  if (n.missingRequiredQty > 0 && n.missingRequiredQty >= n.missingQty) {
    return `Add ${itemsPhrase(n.missingRequiredQty, n.requiredLabel, n.eligibleLabel)} ${unlock}`;
  }
  if (n.missingRequiredQty > 0) {
    return `Add ${n.missingQty} more ${n.eligibleLabel ? `${n.eligibleLabel} ` : ""}items, including ${n.missingRequiredQty} ${n.requiredLabel ?? "required"}, ${unlock}`;
  }
  return `Add ${n.missingQty} more ${n.eligibleLabel ? `${n.eligibleLabel} ` : ""}${n.missingQty === 1 ? "item" : "items"} ${unlock}`;
}

/** Label for the discount row on carts, bills and receipts. */
export function discountLabel(offerName: string | null | undefined): string {
  const name = offerName?.trim();
  return name ? `Discount (${name})` : "Discount";
}
