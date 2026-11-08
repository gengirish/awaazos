import { z } from "zod";

import { normaliseIndianMobile } from "@/lib/phone";

/**
 * The seller's own delivery people (Settings → Online orders → Delivery
 * riders), stored as `VendorSettings.deliveryRiders` JSON. Pure and
 * client-safe.
 *
 * A rider gets an order through the seller's own WhatsApp: the board opens a
 * wa.me link to the rider with the handoff text filled in (`riderWhatsappUrl`
 * in lib/delivery-handoff.ts, which stays zod-free for the board's bundle),
 * and the seller taps send. Nothing is sent from the server.
 */

export const MAX_DELIVERY_RIDERS = 5;
export const RIDER_NAME_MAX = 40;

export type DeliveryRider = { name: string; phone: string };

const INDIAN_MOBILE_E164 = /^\+91[6-9]\d{9}$/;

export const RIDER_PHONE_MESSAGE = "Enter a 10-digit mobile number.";

export const deliveryRiderSchema = z.object({
  name: z.string().trim().min(1, "Enter the rider's name.").max(RIDER_NAME_MAX),
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((v) => normaliseIndianMobile(v))
    .refine((v) => INDIAN_MOBILE_E164.test(v), RIDER_PHONE_MESSAGE),
});

/** What PATCH /api/vendor accepts. The same number twice is refused. */
export const deliveryRidersSchema = z
  .array(deliveryRiderSchema)
  .max(MAX_DELIVERY_RIDERS, `At most ${MAX_DELIVERY_RIDERS} riders.`)
  .refine((rs) => new Set(rs.map((r) => r.phone)).size === rs.length, "Each rider needs a different number.");

/** The stored JSON as riders. Anything malformed is dropped, never thrown. */
export function parseDeliveryRiders(json: unknown): DeliveryRider[] {
  if (!Array.isArray(json)) return [];
  const out: DeliveryRider[] = [];
  for (const row of json) {
    const r = deliveryRiderSchema.safeParse(row);
    if (r.success && !out.some((o) => o.phone === r.data.phone)) out.push(r.data);
    if (out.length === MAX_DELIVERY_RIDERS) break;
  }
  return out;
}
