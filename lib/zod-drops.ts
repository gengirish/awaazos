import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

import { istToUtc, ymdToDbDate } from "@/lib/drops-time";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");
const paise = z.number().int().nonnegative();

export const dropItemInputSchema = z.object({
  menuItemId: z.string().min(1),
  priceInPaise: paise.positive(),
  maxQty: z.number().int().positive().max(10_000).nullable().default(null),
  perOrderLimit: z.number().int().positive().max(1_000).nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
});

function tryIstToUtc(ymdStr: string, hmStr: string): Date | null {
  try {
    return istToUtc(ymdStr, hmStr);
  } catch {
    return null;
  }
}

/** Matches YYYY-MM-DD but names a day that doesn't exist ("2026-02-30"). */
function isImpossibleDay(ymdStr: string): boolean {
  if (!ymd.safeParse(ymdStr).success) return false; // format issue already reported
  try {
    ymdToDbDate(ymdStr);
    return false;
  } catch {
    return true;
  }
}

/**
 * Create / full-replace payload for a Drop. Times are IST wall-clock strings;
 * `dropInputToData` converts them to UTC instants.
 */
export const dropUpsertSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    note: z.string().trim().max(280).nullish(),
    date: ymd, // cooking / fulfilment day (IST)
    fulfilmentMode: z.enum(["DELIVERY", "PICKUP", "BOTH"]),
    fulfilmentStart: hm,
    fulfilmentEnd: hm,
    pickupNote: z.string().trim().max(200).nullish(),
    deliveryFeePaise: paise.max(100_000).default(0),
    opensAtDate: ymd.nullish(),
    opensAtTime: hm.nullish(),
    closesAtDate: ymd,
    closesAtTime: hm,
    items: z.array(dropItemInputSchema).min(1, "Add at least one item").max(100),
  })
  .superRefine((v, ctx) => {
    // Field-level format issues (e.g. "25:00", "2026-02-30") leave the object
    // "dirty" but still run this refinement. istToUtc would throw on them and
    // turn a 400 into a 500, so convert defensively and skip cross-field checks
    // for anything unparseable — its own issue is already reported.
    const start = tryIstToUtc(v.date, v.fulfilmentStart);
    const end = tryIstToUtc(v.date, v.fulfilmentEnd);
    const closes = tryIstToUtc(v.closesAtDate, v.closesAtTime);
    for (const key of ["date", "closesAtDate", "opensAtDate"] as const) {
      const value = v[key];
      if (value && isImpossibleDay(value)) {
        ctx.addIssue({ code: "custom", path: [key], message: "Enter a real calendar date" });
      }
    }
    if (start && end && end <= start) {
      ctx.addIssue({ code: "custom", path: ["fulfilmentEnd"], message: "Window must end after it starts" });
    }
    if (start && closes && closes > start) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAtTime"],
        message: "Orders must close before delivery/pickup starts",
      });
    }
    if ((v.opensAtDate == null) !== (v.opensAtTime == null)) {
      ctx.addIssue({ code: "custom", path: ["opensAtTime"], message: "Give both open date and time, or neither" });
    } else if (v.opensAtDate && v.opensAtTime) {
      const opens = tryIstToUtc(v.opensAtDate, v.opensAtTime);
      if (opens && closes && opens >= closes) {
        ctx.addIssue({ code: "custom", path: ["opensAtTime"], message: "Orders must open before they close" });
      }
    }
    const ids = new Set<string>();
    v.items.forEach((it, i) => {
      if (ids.has(it.menuItemId)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "menuItemId"], message: "Item added twice" });
      }
      ids.add(it.menuItemId);
    });
  });

export type DropUpsertInput = z.infer<typeof dropUpsertSchema>;

/** Validated input → Drop column values (excluding vendorId/status/items). */
export function dropInputToData(v: DropUpsertInput) {
  return {
    title: v.title,
    note: v.note?.trim() || null,
    date: ymdToDbDate(v.date),
    fulfilmentMode: v.fulfilmentMode,
    fulfilmentStartsAt: istToUtc(v.date, v.fulfilmentStart),
    fulfilmentEndsAt: istToUtc(v.date, v.fulfilmentEnd),
    pickupNote: v.pickupNote?.trim() || null,
    deliveryFeePaise: v.fulfilmentMode === "PICKUP" ? 0 : v.deliveryFeePaise,
    opensAt: v.opensAtDate && v.opensAtTime ? istToUtc(v.opensAtDate, v.opensAtTime) : null,
    closesAt: istToUtc(v.closesAtDate, v.closesAtTime),
  };
}

export const dropStatusChangeSchema = z.object({
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"]),
});

/** +91 mobile → E.164, or a Zod issue. */
export const indianPhoneE164 = z
  .string()
  .trim()
  .transform((val, ctx) => {
    const parsed = parsePhoneNumberFromString(val, "IN");
    if (!parsed?.isValid() || parsed.country !== "IN") {
      ctx.addIssue({ code: "custom", message: "Enter a valid +91 mobile number" });
      return z.NEVER;
    }
    return parsed.number; // E.164
  });

/** Public storefront order body. Prices are never accepted from the client. */
export const storefrontOrderSchema = z.object({
  dropId: z.string().min(1),
  items: z
    .array(z.object({ dropItemId: z.string().min(1), qty: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  customerName: z.string().trim().min(1).max(80),
  customerPhone: indianPhoneE164,
  fulfilmentType: z.enum(["DELIVERY", "PICKUP"]),
  deliveryAddress: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(280).nullish(),
  paymentMethod: z.enum(["UPI", "CASH"]),
});

export type StorefrontOrderInput = z.infer<typeof storefrontOrderSchema>;

/** Buyer submits the UTR after paying by UPI. 12 digits is the NPCI norm. */
export const utrSubmitSchema = z.object({
  upiRef: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{10,22}$/, "Enter the 12-digit UPI reference (UTR) from your payment app"),
});

/** Public "order from menu" body (no drop). Prices are never accepted from the client. */
export const storefrontMenuOrderSchema = z.object({
  items: z
    .array(z.object({ menuItemId: z.string().min(1), qty: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  customerName: z.string().trim().min(1).max(80),
  customerPhone: indianPhoneE164,
  fulfilmentType: z.enum(["DELIVERY", "PICKUP"]),
  deliveryAddress: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(280).nullish(),
  paymentMethod: z.enum(["UPI", "CASH"]),
});

export type StorefrontMenuOrderInput = z.infer<typeof storefrontMenuOrderSchema>;
