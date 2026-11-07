/**
 * The API's check for `VendorSettings.deliveryAreas` (PATCH /api/vendor). Kept
 * apart from lib/delivery-areas.ts so the store page doesn't ship zod.
 */
import { z } from "zod";

import {
  deliveryAreaKey,
  MAX_DELIVERY_AREAS,
  toDeliveryArea,
  type DeliveryArea,
} from "@/lib/delivery-areas";

export const deliveryAreasSchema = z
  .array(z.unknown())
  .max(MAX_DELIVERY_AREAS)
  .transform((entries, ctx): DeliveryArea[] => {
    const seen = new Set<string>();
    const out: DeliveryArea[] = [];
    entries.forEach((entry, i) => {
      const area = toDeliveryArea(entry);
      if (!area) {
        ctx.addIssue({ code: "custom", path: [i], message: "Give the area a name and a fee from ₹0 to ₹1,000." });
        return;
      }
      const key = deliveryAreaKey(area.name);
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [i], message: "That area is already on the list." });
        return;
      }
      seen.add(key);
      out.push(area);
    });
    return out;
  });
