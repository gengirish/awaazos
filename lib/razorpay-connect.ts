import { BRAND_NAME } from "@/lib/brand";

/**
 * "Connect Razorpay" links and where the flow comes back to. Pure, client-safe.
 *
 * The flow is full-page navigation: connect route → Razorpay → callback route →
 * a page with `?razorpay=<outcome>`. It starts from Settings → Payments or from
 * first-run setup, and must come back to the one it started from. The way back
 * is a fixed name (`?return=onboarding`), never a URL, so the callback can't be
 * made to redirect anywhere else; anything unknown means Settings → Payments.
 */

export const RAZORPAY_CONNECT_PATH = "/api/vendor/payments/razorpay/connect";

/** The pages the flow can come back to, other than Settings → Payments. */
export type ConnectReturn = "onboarding";

const RETURN_PATHS: Record<ConnectReturn, string> = { onboarding: "/onboarding" };

export const SETTINGS_PAYMENTS_PATH = "/settings/payments";

/** `?return=` / the return cookie → a known return, or null for Settings → Payments. */
export function parseConnectReturn(raw: string | null | undefined): ConnectReturn | null {
  return raw != null && Object.hasOwn(RETURN_PATHS, raw) ? (raw as ConnectReturn) : null;
}

/** The page a finished (or failed) Connect lands on. */
export function connectReturnPath(ret: ConnectReturn | null): string {
  return ret ? RETURN_PATHS[ret] : SETTINGS_PAYMENTS_PATH;
}

/** The link that starts Connect Razorpay from `ret` (null: Settings → Payments). */
export function razorpayConnectHref(ret: ConnectReturn | null = null): string {
  return ret ? `${RAZORPAY_CONNECT_PATH}?return=${ret}` : RAZORPAY_CONNECT_PATH;
}

/** Outcome codes the callback sends back with, and what the seller is told. */
const OUTCOMES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Razorpay connected. Customers can now pay online.", ok: true },
  denied: { text: "You cancelled on Razorpay, so nothing changed.", ok: false },
  expired: {
    text: "That link expired or was opened in another browser. Tap Connect Razorpay again.",
    ok: false,
  },
  upgrade: { text: "Online payments are on the Starter plan.", ok: false },
  owner_only: { text: "Only the owner of this store can connect Razorpay.", ok: false },
  unavailable: { text: `Connect Razorpay isn't switched on for ${BRAND_NAME} yet. Please use API keys.`, ok: false },
  error: { text: "Couldn't connect to Razorpay. Please try again in a minute.", ok: false },
};

/** What to show for `?razorpay=<code>`; an unknown code reads as a failed connect. */
export function connectOutcomeMessage(code: string): { text: string; ok: boolean } {
  return Object.hasOwn(OUTCOMES, code) ? OUTCOMES[code]! : OUTCOMES.error!;
}

/** The shape a page accepts for `?razorpay=` before looking it up. */
export const CONNECT_OUTCOME_RE = /^[a-z_]{1,24}$/;
