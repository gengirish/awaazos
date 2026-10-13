import { z } from "zod";

import { istToUtc, utcToIstParts } from "@/lib/drops-time";
import {
  OFFER_DESCRIPTION_MAX,
  OFFER_MAX_BPS,
  OFFER_MAX_QTY,
  OFFER_MIN_BPS,
  OFFER_NAME_MAX,
  OFFER_TAG_MAX,
  normaliseTag,
} from "@/lib/offers";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const tag = z.string().trim().max(OFFER_TAG_MAX);
const DAY_MS = 24 * 60 * 60 * 1000;

function istDayStart(day: string): Date | null {
  try {
    return istToUtc(day, "00:00");
  } catch {
    return null;
  }
}

/**
 * Create / full-replace payload for an Offer. Dates are IST calendar days:
 * the offer runs from 00:00 on `startsOn` to the end of `endsOn`.
 */
export const offerUpsertSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(OFFER_NAME_MAX),
    description: z.string().trim().max(OFFER_DESCRIPTION_MAX).nullish(),
    eligibility: z.enum(["ALL", "ITEMS", "TAG"]),
    eligibleItemIds: z.array(z.string().min(1)).max(200).default([]),
    eligibleTag: tag.nullish(),
    minQty: z.number().int().min(1).max(OFFER_MAX_QTY),
    requiredTag: tag.nullish(),
    requiredTagQty: z.number().int().min(0).max(OFFER_MAX_QTY).default(0),
    // Fixed amount and bundle price are in the enum for later; not accepted yet.
    discountType: z.literal("PERCENT").default("PERCENT"),
    percentBps: z.number().int().min(OFFER_MIN_BPS).max(OFFER_MAX_BPS),
    onMenuOrders: z.boolean().default(true),
    onDrops: z.boolean().default(true),
    onPos: z.boolean().default(true),
    dropIds: z.array(z.string().min(1)).max(50).default([]),
    isActive: z.boolean().default(true),
    startsOn: ymd.nullish(),
    endsOn: ymd.nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.eligibility === "TAG" && !normaliseTag(v.eligibleTag)) {
      ctx.addIssue({ code: "custom", path: ["eligibleTag"], message: "Enter the tag these items carry" });
    }
    if (v.eligibility === "ITEMS" && v.eligibleItemIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["eligibleItemIds"], message: "Pick at least one item" });
    }
    const required = normaliseTag(v.requiredTag);
    if (required && v.requiredTagQty < 1) {
      ctx.addIssue({ code: "custom", path: ["requiredTagQty"], message: "Enter how many are needed" });
    }
    if (!required && v.requiredTagQty > 0) {
      ctx.addIssue({ code: "custom", path: ["requiredTag"], message: "Enter the tag that is required" });
    }
    if (v.requiredTagQty > v.minQty) {
      ctx.addIssue({
        code: "custom",
        path: ["requiredTagQty"],
        message: "This is more than the minimum quantity",
      });
    }
    if (!v.onMenuOrders && !v.onDrops && !v.onPos) {
      ctx.addIssue({ code: "custom", path: ["onMenuOrders"], message: "Choose where this offer applies" });
    }
    const start = v.startsOn ? istDayStart(v.startsOn) : null;
    const end = v.endsOn ? istDayStart(v.endsOn) : null;
    if (v.startsOn && !start) ctx.addIssue({ code: "custom", path: ["startsOn"], message: "Not a real date" });
    if (v.endsOn && !end) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "Not a real date" });
    if (start && end && end.getTime() < start.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date is before the start date" });
    }
  });

export type OfferUpsertInput = z.infer<typeof offerUpsertSchema>;
/** What a form posts: defaults not applied yet. */
export type OfferUpsertBody = z.input<typeof offerUpsertSchema>;

/** The on/off switch on the offers list. */
export const offerToggleSchema = z.object({ isActive: z.boolean() }).strict();

/** Validated input → Prisma column values (tags normalised, days → UTC instants). */
export function offerInputToData(v: OfferUpsertInput) {
  const required = normaliseTag(v.requiredTag);
  const end = v.endsOn ? istDayStart(v.endsOn) : null;
  return {
    name: v.name,
    description: v.description?.trim() || null,
    eligibility: v.eligibility,
    eligibleItemIds: v.eligibility === "ITEMS" ? Array.from(new Set(v.eligibleItemIds)) : [],
    eligibleTag: v.eligibility === "TAG" ? normaliseTag(v.eligibleTag) : null,
    minQty: v.minQty,
    requiredTag: required || null,
    requiredTagQty: required ? v.requiredTagQty : 0,
    discountType: v.discountType,
    percentBps: v.percentBps,
    onMenuOrders: v.onMenuOrders,
    onDrops: v.onDrops,
    onPos: v.onPos,
    dropIds: v.onDrops ? Array.from(new Set(v.dropIds)) : [],
    isActive: v.isActive,
    startsAt: v.startsOn ? istDayStart(v.startsOn) : null,
    // Exclusive end: the first instant of the day after `endsOn`.
    endsAt: end ? new Date(end.getTime() + DAY_MS) : null,
  };
}

/** Stored instants → the IST days the form edits. */
export function offerDatesToDays(o: { startsAt: Date | null; endsAt: Date | null }) {
  return {
    startsOn: o.startsAt ? utcToIstParts(o.startsAt).ymd : null,
    endsOn: o.endsAt ? utcToIstParts(new Date(o.endsAt.getTime() - 1)).ymd : null,
  };
}

/**
 * "12.5" → 1250 basis points, by string, so no float ever touches the rate.
 * null when it isn't a percentage with at most two decimals.
 */
export function parsePercentInput(raw: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** 1250 → "12.5", for the form field. */
export function percentInputFromBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}`;
}
