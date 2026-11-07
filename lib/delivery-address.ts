/**
 * A delivery address in parts: address line and locality (required at
 * checkout), landmark and pincode (optional, pincode 6 digits).
 *
 * Pure and client-safe. `Transaction.deliveryAddress` keeps the whole address
 * as one text (`composeDeliveryAddress`), so every place that already shows or
 * sends it (rider handoff, WhatsApp text, order page) keeps working; the parts
 * sit beside it so the board and the packing list can lead with the locality.
 * Orders and saved buyers from before the parts existed have the line only.
 *
 * PII: never in a log, a push payload or an LLM prompt.
 */

export const ADDRESS_LINE_MAX = 300;
export const LOCALITY_MAX = 80;
export const LANDMARK_MAX = 120;

export type DeliveryAddressParts = {
  line: string;
  locality: string;
  landmark: string;
  pincode: string;
};

const PINCODE = /^[1-9]\d{5}$/;

/** "560 064" / " 560064 " → "560064"; "" stays "". */
export function normalisePincode(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function isValidPincode(pincode: string): boolean {
  return PINCODE.test(normalisePincode(pincode));
}

/** "Flat 302, Lake View Apts, Near Ganesh temple, Kondapur 500084" */
export function composeDeliveryAddress(parts: Partial<DeliveryAddressParts>): string {
  const line = parts.line?.trim() ?? "";
  const landmark = parts.landmark?.trim() ?? "";
  const locality = parts.locality?.trim() ?? "";
  const pincode = normalisePincode(parts.pincode ?? "");
  const place = [locality, pincode].filter(Boolean).join(" ");
  const near = landmark && !/^near\b/i.test(landmark) ? `Near ${landmark}` : landmark;
  return [line, near, place].filter(Boolean).join(", ");
}

/** Empty parts → null, pincode spaces removed: what goes in the database. */
export function storedAddressParts(parts: Partial<DeliveryAddressParts>): {
  locality: string | null;
  landmark: string | null;
  pincode: string | null;
} {
  return {
    locality: parts.locality?.trim() || null,
    landmark: parts.landmark?.trim() || null,
    pincode: normalisePincode(parts.pincode ?? "") || null,
  };
}

/**
 * The Transaction columns for a delivery order, from what checkout posted:
 * `deliveryAddress` is the whole address (null without an address line), the
 * parts sit beside it. Shared by drop and menu orders.
 */
export function deliveryFields(input: {
  deliveryAddress?: string | null;
  deliveryLocality?: string | null;
  deliveryLandmark?: string | null;
  deliveryPincode?: string | null;
}): {
  deliveryAddress: string | null;
  deliveryLocality: string | null;
  deliveryLandmark: string | null;
  deliveryPincode: string | null;
} {
  const line = input.deliveryAddress?.trim() ?? "";
  const parts = storedAddressParts({
    locality: input.deliveryLocality ?? "",
    landmark: input.deliveryLandmark ?? "",
    pincode: input.deliveryPincode ?? "",
  });
  return {
    deliveryAddress: line
      ? composeDeliveryAddress({
          line,
          locality: parts.locality ?? "",
          landmark: parts.landmark ?? "",
          pincode: parts.pincode ?? "",
        })
      : null,
    deliveryLocality: parts.locality,
    deliveryLandmark: parts.landmark,
    deliveryPincode: parts.pincode,
  };
}
