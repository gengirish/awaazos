/**
 * UPI deep link (rupees on the wire). See spec UPI rules. QR images are
 * rendered locally from these links by `lib/qr.ts`.
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

/**
 * App-specific UPI links — iPhone support.
 *
 * Android resolves `upi://pay?…` to whichever UPI app the buyer picks. iOS has
 * no such chooser: several apps register the `upi` scheme and iOS opens one
 * arbitrarily (or nothing at all). Each big app also registers a scheme of its
 * own, so on iOS we offer one button per app with the SAME query string — the
 * NPCI params (`pa`, `pn`, `am`, `cu`, `tn`) are unchanged, only the prefix
 * differs.
 *
 * Prefixes follow Razorpay's "UPI Intent on iOS" S2S guide, which rewrites the
 * gateway's `upi://pay?…` intent per app (`tez` and `paytmmp` are also the
 * `LSApplicationQueriesSchemes` entries Razorpay and Cashfree tell iOS apps to
 * declare). Blog posts often cite `gpay://upi/pay` and `paytmmp://pay` instead;
 * those are unverified here. Check on a real iPhone before changing any of them.
 */
export type UpiAppId = "gpay" | "phonepe" | "paytm";

export type UpiApp = { id: UpiAppId; label: string; prefix: string };

export const UPI_APPS: readonly UpiApp[] = [
  { id: "gpay", label: "Google Pay", prefix: "tez://upi/pay" },
  { id: "phonepe", label: "PhonePe", prefix: "phonepe://pay" },
  { id: "paytm", label: "Paytm", prefix: "paytmmp://upi/pay" },
];

const GENERIC_UPI_PREFIX = "upi://pay?";

/**
 * Re-targets a link from `buildUpiDeepLink` / `buildUpiCollectLink` at one
 * app's own scheme. Returns `null` for anything that is not a `upi://pay?` link
 * so a malformed input can never turn into a button.
 */
export function upiAppLink(app: UpiAppId, upiLink: string): string | null {
  if (!upiLink.startsWith(GENERIC_UPI_PREFIX)) return null;
  const def = UPI_APPS.find((a) => a.id === app);
  if (!def) return null;
  return `${def.prefix}?${upiLink.slice(GENERIC_UPI_PREFIX.length)}`;
}

/** Every app-specific link for one UPI intent, in display order. */
export function upiAppLinks(upiLink: string): { id: UpiAppId; label: string; href: string }[] {
  return UPI_APPS.flatMap((a) => {
    const href = upiAppLink(a.id, upiLink);
    return href ? [{ id: a.id, label: a.label, href }] : [];
  });
}

/**
 * True on iPhone / iPad / iPod. iPadOS 13+ reports a desktop Mac user agent, so
 * a "Mac" with a touch screen counts too. Pure so it can be unit-tested; call it
 * from an effect (never during render) to avoid a hydration mismatch.
 */
export function isAppleMobile(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent) || /iPhone|iPad|iPod/i.test(platform)) return true;
  const macLike = /Macintosh/i.test(userAgent) || /^Mac/i.test(platform);
  return macLike && maxTouchPoints > 1;
}

/**
 * Amount for the buyer to paste into a UPI app's amount field: `120` or
 * `120.50`. Integer maths on paise (no `toFixed`), never a currency symbol or
 * thousands separator, which some UPI apps reject on paste.
 */
export function upiAmountText(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError("paise must be a non-negative integer");
  const frac = paise % 100;
  const whole = (paise - frac) / 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * UPI virtual payment address, e.g. `name@okaxis`: a handle, `@`, and the
 * bank/PSP suffix. Shared by the settings form, onboarding and PATCH /api/vendor
 * so a typo is caught before it ends up inside every QR the stall shows.
 */
export const UPI_ID_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** Trims surrounding whitespace. Case is left alone: UPI apps resolve either. */
export function normalizeUpiId(raw: string): string {
  return raw.trim();
}

export function isValidUpiId(raw: string): boolean {
  return UPI_ID_PATTERN.test(normalizeUpiId(raw));
}

export const UPI_ID_FORMAT_MESSAGE = "That doesn't look like a UPI ID. It should look like name@okaxis.";
