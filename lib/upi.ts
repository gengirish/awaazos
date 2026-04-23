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
