import type { StallType } from "@prisma/client";
import { z } from "zod";

import { STALL_TYPES } from "@/lib/constants";

/**
 * "What do you sell?" with an escape hatch: a seller whose business is not in
 * STALL_TYPES picks "Other" and describes it ("Pickles & podis"). The words go
 * in `Vendor.stallTypeOther` and are shown on the public store page in place of
 * the type's label. Pure and client-safe: sign-up, onboarding, Settings and
 * PATCH /api/vendor all use these rules.
 */

export const STALL_TYPE_OTHER_MAX = 40;

export const STALL_TYPE_OTHER_MESSAGE = `Describe what you sell in 2 to ${STALL_TYPE_OTHER_MAX} characters.`;

/** The seller's description, trimmed and with inner whitespace collapsed. */
export const stallTypeOtherSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, STALL_TYPE_OTHER_MESSAGE).max(STALL_TYPE_OTHER_MAX, STALL_TYPE_OTHER_MESSAGE));

/**
 * The description to store for a chosen type: required for OTHER (an error
 * message when missing or invalid), always null for any listed type.
 */
export function resolveStallTypeOther(
  stallType: StallType,
  description: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (stallType !== "OTHER") return { ok: true, value: null };
  const parsed = stallTypeOtherSchema.safeParse(description ?? "");
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: STALL_TYPE_OTHER_MESSAGE };
}

/** What a public page calls the store's type. */
export function stallTypeLabel(stallType: StallType, stallTypeOther: string | null | undefined): string {
  if (stallType === "OTHER") return stallTypeOther?.trim() || "Store";
  return STALL_TYPES.find((t) => t.value === stallType)?.label ?? "Store";
}
