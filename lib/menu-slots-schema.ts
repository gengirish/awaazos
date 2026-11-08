/**
 * The API's check for `VendorSettings.menuSlots` (PATCH /api/vendor). Kept apart
 * from lib/menu-slots.ts so client bundles that read slots don't ship zod.
 */
import { z } from "zod";

import { MAX_MENU_SLOT_RULES, toMenuSlotRule, type MenuSlotRule } from "@/lib/menu-slots";

export const menuSlotsSchema = z
  .array(z.unknown())
  .max(MAX_MENU_SLOT_RULES)
  .transform((rules, ctx): MenuSlotRule[] => {
    const out: MenuSlotRule[] = [];
    rules.forEach((r, i) => {
      const rule = toMenuSlotRule(r);
      if (rule) out.push(rule);
      else ctx.addIssue({ code: "custom", path: [i], message: "Pick at least one day, and an end time after the start." });
    });
    return out;
  });
