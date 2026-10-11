/**
 * Razorpay Standard Checkout loader, shared by the storefront "Pay online"
 * button (the vendor's own Razorpay account, an Order) and the billing page
 * (the platform account, a Subscription). Client-only.
 *
 * checkout.js is loaded on the first tap, not on page load — most visitors
 * never need it. The CSP in next.config.mjs already allows its origin.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Checkout success for an Order (storefront). */
export type RazorpayOrderSuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/** Checkout success for a Subscription (platform billing). */
export type RazorpaySubscriptionSuccess = {
  razorpay_subscription_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type CommonOptions = {
  key: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
  retry?: { enabled: boolean };
};

export type RazorpayOrderOptions = CommonOptions & {
  amount: number;
  currency: string;
  order_id: string;
  handler: (resp: RazorpayOrderSuccess) => void;
};

export type RazorpaySubscriptionOptions = CommonOptions & {
  subscription_id: string;
  handler: (resp: RazorpaySubscriptionSuccess) => void;
};

export type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", cb: (resp: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOrderOptions | RazorpaySubscriptionOptions) => RazorpayInstance;
  }
}

let checkoutPromise: Promise<void> | null = null;

/** Resolves once `window.Razorpay` exists. Rejects if the script can't load; the next call retries. */
export function loadCheckout(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  if (checkoutPromise) return checkoutPromise;
  checkoutPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("checkout_missing")));
    s.onerror = () => reject(new Error("checkout_load_failed"));
    document.body.appendChild(s);
  }).catch((e: unknown) => {
    checkoutPromise = null; // allow a retry on the next tap
    throw e;
  });
  return checkoutPromise;
}
