"use client";

import { CreditCard, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { loadCheckout, type RazorpayOrderSuccess } from "@/lib/razorpay-checkout";
import {
  checkoutCancelledMessage,
  checkoutLoadFailedMessage,
  directPayOfferLabel,
  PAY_NOW_PARAM,
  startErrorMessage,
  startErrorOpensDirectPay,
  type DirectPayFallback,
} from "@/lib/storefront-direct-pay";

/**
 * "Pay online" for a storefront order, through the store's OWN Razorpay
 * account (Razorpay Standard Checkout). Flow:
 *
 *   1. POST …/razorpay        → server creates/reuses a Razorpay Order for the
 *                                exact order total; returns the public key id.
 *   2. Load checkout.js on click (not on page load — most buyers never need it).
 *   3. Checkout success       → POST …/razorpay/verify (server checks the HMAC
 *                                with the vendor's secret, or asks Razorpay for a
 *                                "Connect Razorpay" store) → router.refresh().
 *
 * The webhooks mark the order paid independently, so if step 3 fails
 * (flaky network) the buyer is pointed at the order page's "Check for update"
 * button (OrderRefresh) rather than told to pay again.
 *
 * `onOfferDirectPay` fires when Razorpay can't take this payment, so the page can
 * show the way to pay without it (lib/storefront-direct-pay.ts). Closing the window
 * isn't a failure: it only leaves a quiet link to the same place, so a change of mind
 * doesn't end in a payment the seller has to check by hand. Never once Checkout
 * reports success: the buyer has paid and must not be invited to pay again.
 *
 * `autoStart` runs the same `start()` once on arrival from checkout and takes
 * `?pay=1` out of the address, so a reload or Back never reopens the window. The
 * button stays usable in case the window doesn't appear (nothing reports that).
 *
 * `prefillName` / `prefillContact` are the buyer's own details on the buyer's
 * own order page; they go only to Razorpay Checkout, never to a log.
 */

type StartPaymentData = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  name: string;
  billNumber: string;
};

export function RazorpayPayButton({
  slug,
  token,
  amountLabel,
  prefillName,
  prefillContact,
  fallback,
  onOfferDirectPay,
  directPayOpen,
  autoStart,
}: {
  slug: string;
  token: string;
  amountLabel: string;
  prefillName?: string | null;
  prefillContact?: string | null;
  fallback: DirectPayFallback;
  onOfferDirectPay: () => void;
  directPayOpen: boolean;
  autoStart: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [closedWindow, setClosedWindow] = useState(false);
  const paid = useRef(false);
  const autoStarted = useRef(false);

  const base = `/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/razorpay`;

  async function confirm(resp: RazorpayOrderSuccess) {
    paid.current = true;
    setBusy(true);
    setMessage({ text: "Payment received — confirming with the store…", tone: "info" });
    try {
      const res = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resp),
      });
      if (res.ok) {
        setMessage({ text: "Paid! Updating your order…", tone: "info" });
        router.refresh();
        return;
      }
      const verifyError = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      // not_paid_yet: Razorpay hasn't captured it yet (OAuth stores) — the webhook will.
      if (res.status === 409 && verifyError !== "not_paid_yet") {
        setMessage({
          text: "Your payment went through, but this order was closed in the meantime. Please message the store — they'll refund or confirm it.",
          tone: "error",
        });
      } else {
        setMessage({
          text: "Your payment went through. We're still confirming it — tap “Check for update” above in a minute. Please don't pay again.",
          tone: "info",
        });
      }
    } catch {
      setMessage({
        text: "Your payment went through. We're still confirming it — tap “Check for update” above in a minute. Please don't pay again.",
        tone: "info",
      });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setClosedWindow(false);
    try {
      const res = await fetch(base, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { data?: StartPaymentData; error?: string };
      if (!res.ok || !json.data) {
        setMessage({
          text: startErrorMessage(json.error, fallback),
          tone: json.error === "payment_processing" ? "info" : "error",
        });
        if (startErrorOpensDirectPay(json.error)) onOfferDirectPay();
        setBusy(false);
        return;
      }
      const data = json.data;

      try {
        await loadCheckout();
      } catch {
        setMessage({
          text: checkoutLoadFailedMessage(fallback),
          tone: "error",
        });
        onOfferDirectPay();
        setBusy(false);
        return;
      }
      const Razorpay = window.Razorpay;
      if (!Razorpay) {
        setMessage({ text: checkoutLoadFailedMessage(fallback), tone: "error" });
        onOfferDirectPay();
        setBusy(false);
        return;
      }

      const rzp = new Razorpay({
        key: data.keyId,
        amount: data.amountPaise,
        currency: data.currency,
        name: data.name,
        description: `Order ${data.billNumber}`,
        order_id: data.razorpayOrderId,
        prefill: {
          ...(prefillName ? { name: prefillName } : {}),
          ...(prefillContact ? { contact: prefillContact } : {}),
        },
        handler: (resp: RazorpayOrderSuccess) => {
          void confirm(resp);
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (paid.current) return;
            setBusy(false);
            setClosedWindow(true);
            setMessage((m) => (m?.tone === "error" ? m : { text: checkoutCancelledMessage(), tone: "info" }));
          },
        },
      });
      rzp.on("payment.failed", () => {
        // Checkout lets the buyer retry inside the window; this just leaves a note.
        setMessage({ text: "That payment didn't go through. No money was taken — try again or use another method.", tone: "error" });
        onOfferDirectPay();
      });
      rzp.open();
      // The window covers the button. If it never appeared, the button must still work.
      if (!paid.current) setBusy(false);
    } catch {
      setMessage({ text: "Couldn't reach the store — check your connection and try again.", tone: "error" });
      onOfferDirectPay();
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(PAY_NOW_PARAM);
    window.history.replaceState(null, "", url);
    void start();
    // Once, on arrival: `start` reads only values that are fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offerLabel = closedWindow && !directPayOpen && !busy ? directPayOfferLabel(fallback) : null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-primary-foreground shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <CreditCard className="h-5 w-5" aria-hidden="true" />
        )}
        Pay {amountLabel} online
      </button>
      <p className="text-xs text-muted-foreground">UPI, cards or netbanking · secured by Razorpay</p>
      <div aria-live="polite">
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : undefined}
            className={message.tone === "error" ? "text-sm font-medium text-destructive" : "text-sm font-medium"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
      {offerLabel ? (
        <button
          type="button"
          onClick={onOfferDirectPay}
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {offerLabel}
        </button>
      ) : null}
    </div>
  );
}
