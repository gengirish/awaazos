/**
 * The FSSAI number a food store shows buyers (`VendorSettings.fssaiNumber`).
 * Client-safe: Settings, setup and PATCH /api/vendor check it the same way.
 */

/** FSSAI registration and licence numbers are exactly 14 digits. */
export const FSSAI_NUMBER_PATTERN = /^\d{14}$/;
export const FSSAI_NUMBER_MESSAGE = "FSSAI number must be exactly 14 digits.";
