"use client";

import Link from "next/link";
import { useState } from "react";

import { formatINR, formatINRCompact } from "@/lib/currency";
import { loadCheckout, type RazorpaySubscriptionSuccess } from "@/lib/razorpay-checkout";
import {
  subscriptionBasePaise,
  subscriptionChargePaise,
  type BillingInterval,
} from "@/lib/subscription";
import { Button } from "@/components/ui/button";

/**
 * Subscribe / cancel controls for the billing page.
 *
 * Subscribing (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md, Phase 4):
 *   1. POST /api/razorpay/create-subscription → subscription id + public key id.
 *   2. Razorpay Checkout opens in place (checkout.js loads on the first tap).
 *      If it can't load, fall back to Razorpay's hosted page (`shortUrl`).
 *   3. Checkout success → POST /api/razorpay/verify-subscription, which checks
 *      the signature and applies the plan → reload.
 *
 * The webhook applies the same payment independently, so if step 3 can't
 * confirm (flaky network, Razorpay still settling) the vendor is told to
 * refresh, never to pay again.
 */

const INTERVAL_LABEL: Record<BillingInterval, { button: string; per: string }> = {
  monthly: { button: "Starter monthly", per: "/month" },
  yearly: { button: "Starter yearly", per: "/year" },
};

/** Verify attempts after a payment, while Razorpay moves the subscription to active. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_GAP_MS = 2_500;

const STILL_CONFIRMING =
  "Payment received. Your plan will switch on within a minute — refresh this page. Please don't pay again.";

type Message = { text: string; tone: "error" | "info" };

export function BillingManageClient({
  canSubscribe,
  canCancel,
  cancelAtEnd,
  prefillName,
  prefillEmail,
}: {
  /** Not on a paid plan and no subscription already collecting (trial, locked or free). */
  canSubscribe: boolean;
  /** A subscription that is collecting (or about to) is on file. */
  canCancel: boolean;
  /** Cancelled, still paid up until the cycle ends. */
  cancelAtEnd: boolean;
  /** The signed-in owner's own details, sent only to Razorpay Checkout. */
  prefillName?: string | null;
  prefillEmail?: string | null;
}) {
  // PRO is not sold (TODO.md §2): only STARTER, monthly or yearly.
  const [pending, setPending] = useState<null | "cancel" | BillingInterval>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function confirmPayment(resp: RazorpaySubscriptionSuccess) {
    setMessage({ text: "Payment received — switching on your plan…", tone: "info" });
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((r) => window.setTimeout(r, VERIFY_GAP_MS));
      try {
        const res = await fetch("/api/razorpay/verify-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resp),
        });
        if (res.ok) {
          const json = (await res.json()) as { data?: { active?: boolean } };
          if (json.data?.active) {
            setMessage({ text: "You're subscribed. Updating this page…", tone: "info" });
            window.location.reload();
            return;
          }
          continue; // paid, Razorpay hasn't activated it yet
        }
        if (res.status === 400 || res.status === 404) {
          setMessage({
            text: "We couldn't match that payment to your account. If money was taken, contact support before paying again.",
            tone: "error",
          });
          setPending(null);
          return;
        }
      } catch {
        // network blip: try again, then fall through to "still confirming"
      }
    }
    setMessage({ text: STILL_CONFIRMING, tone: "info" });
    setPending(null);
  }

  async function subscribe(interval: BillingInterval) {
    setMessage(null);
    setPending(interval);
    try {
      const res = await fetch("/api/razorpay/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "STARTER", interval }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        subscriptionId?: string;
        shortUrl?: string;
        keyId?: string;
      };
      if (!res.ok || !data.subscriptionId) {
        setMessage({ text: data.error ?? "Couldn't start the subscription. Please try again.", tone: "error" });
        setPending(null);
        return;
      }

      const loaded = await loadCheckout().then(
        () => true,
        () => false,
      );
      const Razorpay = window.Razorpay;
      if (!loaded || !Razorpay || !data.keyId) {
        // No in-app window: Razorpay's hosted page still takes the payment,
        // and the webhook applies it.
        if (data.shortUrl) {
          window.location.href = data.shortUrl;
          return;
        }
        setMessage({ text: "Couldn't load the payment window. Check your connection and try again.", tone: "error" });
        setPending(null);
        return;
      }

      const rzp = new Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "AwaazOS",
        description: `${INTERVAL_LABEL[interval].button} — ${formatINR(subscriptionChargePaise("STARTER", interval))} incl. GST`,
        prefill: {
          ...(prefillName ? { name: prefillName } : {}),
          ...(prefillEmail ? { email: prefillEmail } : {}),
        },
        handler: (resp: RazorpaySubscriptionSuccess) => {
          void confirmPayment(resp);
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setPending(null);
            setMessage((m) => m ?? { text: "Payment cancelled. Nothing was charged — you can try again.", tone: "info" });
          },
        },
      });
      rzp.on("payment.failed", () => {
        // Checkout lets the vendor retry inside the window; this just leaves a note.
        setMessage({ text: "That payment didn't go through. No money was taken — try again or use another method.", tone: "error" });
      });
      rzp.open();
    } catch {
      setMessage({ text: "Couldn't reach the server — check your connection and try again.", tone: "error" });
      setPending(null);
    }
  }

  async function cancel() {
    setMessage(null);
    setPending("cancel");
    try {
      const res = await fetch("/api/razorpay/cancel-subscription", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; cancelAtEnd?: boolean };
      if (!res.ok) {
        setMessage({ text: data.error ?? "Couldn't cancel. Please try again.", tone: "error" });
        return;
      }
      setMessage({
        text: data.cancelAtEnd
          ? "Cancelled. Your plan stays on until the end of the period you paid for."
          : "Cancelled. Nothing more will be charged.",
        tone: "info",
      });
      window.setTimeout(() => window.location.reload(), 1500);
    } catch {
      setMessage({ text: "Couldn't reach the server — check your connection and try again.", tone: "error" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canSubscribe ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {(["monthly", "yearly"] as const).map((interval) => (
            <Button
              key={interval}
              type="button"
              variant={interval === "yearly" ? "outline" : "default"}
              className="min-h-11 h-auto flex-col items-start py-2 text-left"
              disabled={pending !== null}
              aria-busy={pending === interval}
              onClick={() => void subscribe(interval)}
            >
              <span>{pending === interval ? "Opening payment…" : INTERVAL_LABEL[interval].button}</span>
              <span className="text-xs font-normal opacity-80">
                {formatINRCompact(subscriptionBasePaise("STARTER", interval))}
                {INTERVAL_LABEL[interval].per} + GST ={" "}
                {formatINR(subscriptionChargePaise("STARTER", interval))}
                {interval === "yearly" ? " · 2 months free" : ""}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {canSubscribe ? (
        <p className="text-xs text-muted-foreground">UPI Autopay, cards or netbanking · secured by Razorpay</p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {canCancel && !cancelAtEnd ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => void cancel()}
          >
            {pending === "cancel" ? "Cancelling…" : "Cancel subscription"}
          </Button>
        ) : null}
        <Button asChild variant="ghost" className="min-h-11">
          <Link href="/pricing">View pricing</Link>
        </Button>
      </div>
      {cancelAtEnd ? (
        <p className="text-sm text-muted-foreground">
          Subscription cancelled. Your plan stays on until the end of the period you paid for.
        </p>
      ) : null}
      <div aria-live="polite">
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error" ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
