/**
 * The FSSAI number a food store shows buyers (`VendorSettings.fssaiNumber`).
 * Client-safe: Settings, setup and PATCH /api/vendor check it the same way.
 */

/** FSSAI registration and licence numbers are exactly 14 digits. */
export const FSSAI_NUMBER_PATTERN = /^\d{14}$/;
export const FSSAI_NUMBER_MESSAGE = "FSSAI number must be exactly 14 digits.";

/**
 * Whether Settings → Online store warns that a food licence is required by law:
 * a food store that is live and has no number saved. A warning only, never a
 * gate on publishing; goods stores (many need no licence) never see it.
 */
export function showFssaiWarning(s: {
  kind: "food" | "goods";
  publishStorefront: boolean;
  fssaiNumber: string | null | undefined;
}): boolean {
  return s.kind === "food" && s.publishStorefront && !s.fssaiNumber?.trim();
}

export const FSSAI_WARNING_TEXT =
  "FSSAI registration or licence is required by law for anyone selling food. Your store is live without one. Add your 14-digit number now so buyers can see it.";
