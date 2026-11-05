/**
 * When a store takes Razorpay, direct UPI is the way out when Razorpay fails,
 * not a second option beside it. A direct payment needs the seller to check it
 * by hand, while Razorpay confirms itself.
 *
 * Pure rules plus one best-effort localStorage wrapper, safe in client components.
 *
 * Offering direct UPI after the buyer may have paid invites a double payment, so
 * `payment_processing` and the "order moved on" errors never open it.
 */

/** What the buyer can do if Razorpay fails: pay by UPI, message the store, or neither. */
export type DirectPayFallback = "upi" | "message" | null;

/** Errors from `POST …/razorpay` that must leave direct UPI closed. */
const KEEPS_DIRECT_PAY_CLOSED = new Set(["order_expired", "not_awaiting_payment", "payment_processing", "rate_limited"]);

export function startErrorOpensDirectPay(error: string | undefined): boolean {
  return !KEEPS_DIRECT_PAY_CLOSED.has(error ?? "");
}

/** The end of a "try again" sentence, naming only a way out this store really has. */
function orElse(fallback: DirectPayFallback): string {
  if (fallback === "upi") return ", or pay by UPI below.";
  if (fallback === "message") return ", or message the store to pay.";
  return ".";
}

export function startErrorMessage(error: string | undefined, fallback: DirectPayFallback): string {
  switch (error) {
    case "order_expired":
      return "This order's hold has expired, so the items were released. Please place the order again.";
    case "not_awaiting_payment":
      return "This order isn't waiting for payment any more. Tap “Check for update” above to see its status.";
    case "payment_processing":
      return "Your payment went through — we're confirming it. Tap “Check for update” above in a minute.";
    case "rate_limited":
      return "Too many attempts. Please wait a minute and try again.";
    case "online_payment_unavailable":
      return `Online payment isn't available for this store right now. ${
        fallback === "upi"
          ? "Please pay by UPI below."
          : fallback === "message"
            ? "Please message the store to pay."
            : "Please try again later."
      }`;
    case "razorpay_unavailable":
      return `Couldn't reach the payment service. Please try again${orElse(fallback)}`;
    default:
      return `Couldn't start the payment. Please try again${orElse(fallback)}`;
  }
}

export function checkoutLoadFailedMessage(fallback: DirectPayFallback): string {
  return `Couldn't load the payment window. Check your connection${orElse(fallback)}`;
}

export function checkoutCancelledMessage(): string {
  return "Payment cancelled. You can try again.";
}

/** The quiet way out after the buyer closes Razorpay's window; null when the store has none. */
export function directPayOfferLabel(fallback: DirectPayFallback): string | null {
  if (fallback === "upi") return "Pay by UPI instead";
  if (fallback === "message") return "Message the store instead";
  return null;
}

/** Added by checkout for a Razorpay order: the order page opens Razorpay on arrival, once. */
export const PAY_NOW_PARAM = "pay";

/** Where checkout sends the buyer. WhatsApp goes first when asked for, so it wins over paying now. */
export function orderPagePath(
  slug: string,
  token: string,
  opts: { viaWhatsapp: boolean; payNow: boolean },
): string {
  const query = opts.viaWhatsapp ? "?wa=1" : opts.payNow ? `?${PAY_NOW_PARAM}=1` : "";
  return `/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(token)}${query}`;
}

/**
 * The UPI app often runs in another task, and a phone may reload this page on the
 * way back. Remembering the order keeps "Payment done?" there for a buyer who has
 * just paid directly. One token only: a forgotten order just asks Razorpay again.
 */
const STORAGE_KEY = "awz-direct-pay";

export function rememberDirectPayOpened(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Blocked or full storage just means this isn't remembered.
  }
}

export function directPayWasOpened(token: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === token;
  } catch {
    return false;
  }
}
