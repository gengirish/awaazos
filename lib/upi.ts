/**
 * UPI deep link (rupees on the wire) + QR image URL. See spec UPI rules.
 */

export type BuildUpiDeepLinkParams = {
  upiId: string;
  name: string;
  amountRupees: number;
  billRef: string;
};

export function buildUpiDeepLink({ upiId, name, amountRupees, billRef }: BuildUpiDeepLinkParams): string {
  const am = amountRupees.toFixed(2);
  const params = new URLSearchParams({
    pa: upiId,
    pn: name,
    am,
    cu: "INR",
    tn: billRef,
  });
  return `upi://pay?${params.toString()}`;
}

export function buildQrUrl(upiLink: string, size = 256): string {
  const encoded = encodeURIComponent(upiLink);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`;
}

/**
 * Standing "pay this stall" link — same UPI intent, no amount.
 *
 * The customer types the amount in their own UPI app, which is how a street
 * stall already works when the vendor tapes a QR to the cart. Used by the
 * public storefront, where no cart exists and nothing is server-authoritative.
 *
 * Deliberately omits `am` and `tn`: a UPI intent carrying an amount we cannot
 * verify would look like a bill AwaazOS issued, and there is no transaction
 * behind it.
 */
export function buildUpiCollectLink({ upiId, name }: { upiId: string; name: string }): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: name,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}
