"use client";

import Link from "next/link";
import { useState } from "react";

import type { PlanOffer, SubscribeAction } from "@/lib/billing-actions";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { loadCheckout, type RazorpaySubscriptionSuccess } from "@/lib/razorpay-checkout";
import { PLAN_LIMITS } from "@/lib/constants";
import {
  BILLING_INTERVALS,
  gstPaise,
  storeBasePaise,
  subscriptionBasePaise,
  type BillingInterval,
  type SubscribablePlan,
} from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { RadioOption } from "@/components/ui/radio-option";

/**
 * Plan picker and cancel control for the billing page. What it may offer comes
 * from the server (lib/billing-actions.ts), which applies the same rule again.
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

const INTERVAL_LABEL: Record<BillingInterval, { word: string; per: string }> = {
  monthly: { word: "monthly", per: "/month" },
  yearly: { word: "yearly", per: "/year" },
};

function buttonLabel(plan: SubscribablePlan, interval: BillingInterval): string {
  return `${PLAN_LIMITS[plan].label} ${INTERVAL_LABEL[interval].word}`;
}

/** One cycle before GST. A store's own price is a price for Starter. */
function basePaise(plan: SubscribablePlan, interval: BillingInterval, customPricePaise: number | null): number {
  return plan === "STARTER" ? storeBasePaise(interval, customPricePaise) : subscriptionBasePaise(plan, interval);
}

const ACTION_WORD: Record<SubscribeAction, string> = {
  subscribe: "Subscribe",
  resubscribe: "Resubscribe",
  upgrade: "Upgrade",
};

const INTERVAL_CHOICE: Record<BillingInterval, string> = {
  monthly: "Monthly",
  yearly: "Yearly · 2 months free",
};

type Pending = { plan: SubscribablePlan; interval: BillingInterval };

/** What to tell the owner when the server won't start a subscription. Never a raw code or a 500's text. */
function subscribeErrorText(status: number, error: string | undefined): string {
  if (error === "demo_store_not_billable") return "A demo store can't subscribe. Claim the store first.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (status >= 500 || !error) return "Couldn't start the subscription. Please try again.";
  return error;
}

/** Verify attempts after a payment, while Razorpay moves the subscription to active. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_GAP_MS = 2_500;

const STILL_CONFIRMING =
  "Payment received. Your plan will switch on within a minute — refresh this page. Please don't pay again.";

type Message = { text: string; tone: "error" | "info" };

export function BillingManageClient({
  offers,
  initialPlan,
  initialInterval,
  payingForLabel,
  paidUntilLabel,
  unavailableNote,
  canCancel,
  cancelAtEnd,
  prefillName,
  prefillEmail,
  customPricePaise,
}: {
  /** Plans this store can buy now. Empty when paying for the top one, or one is about to start. */
  offers: readonly PlanOffer[];
  /** Preselected from the pricing page's link, or the default. */
  initialPlan: SubscribablePlan | null;
  initialInterval: BillingInterval;
  /** The plan being paid for right now, if any. */
  payingForLabel: string | null;
  /** IST date the paid period ends, if there is one. */
  paidUntilLabel: string | null;
  /** The pricing page asked for a plan that isn't on offer: why. */
  unavailableNote: string | null;
  /** A subscription that is collecting (or about to) is on file. */
  canCancel: boolean;
  /** Cancelled, still paid up until the cycle ends. */
  cancelAtEnd: boolean;
  /** The signed-in owner's own details, sent only to Razorpay Checkout. */
  prefillName?: string | null;
  prefillEmail?: string | null;
  /** This store's own price (lib/subscription.ts). Null = the list price. */
  customPricePaise: number | null;
}) {
  const [plan, setPlan] = useState<SubscribablePlan | null>(initialPlan);
  const [interval, setBillingInterval] = useState<BillingInterval>(initialInterval);
  const [pending, setPending] = useState<null | "cancel" | Pending>(null);
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

  async function subscribe(plan: SubscribablePlan, interval: BillingInterval) {
    setMessage(null);
    setPending({ plan, interval });
    try {
      const res = await fetch("/api/razorpay/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        subscriptionId?: string;
        shortUrl?: string;
        keyId?: string;
      };
      if (!res.ok || !data.subscriptionId) {
        setMessage({ text: subscribeErrorText(res.status, data.error), tone: "error" });
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

      const base = basePaise(plan, interval, customPricePaise);
      const rzp = new Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "AwaazOS",
        description: `${buttonLabel(plan, interval)} — ${formatINR(base + gstPaise(base))} incl. GST`,
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

  const offer = offers.find((o) => o.plan === plan) ?? null;
  const selectedBase = offer ? basePaise(offer.plan, interval, customPricePaise) : 0;
  const busy = pending !== null;

  return (
    <div className="flex flex-col gap-4">
      {unavailableNote ? <p className="text-sm text-muted-foreground">{unavailableNote}</p> : null}
      {offer ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void subscribe(offer.plan, interval);
          }}
        >
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Plan</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {offers.map((o) => {
                const base = basePaise(o.plan, interval, customPricePaise);
                return (
                  <RadioOption
                    key={o.plan}
                    name="billing-plan"
                    value={o.plan}
                    checked={o.plan === offer.plan}
                    onChange={() => setPlan(o.plan)}
                    label={PLAN_LIMITS[o.plan].label}
                    hint={`${formatINRCompact(base)}${INTERVAL_LABEL[interval].per} + GST`}
                  />
                );
              })}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Billed</legend>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
              {BILLING_INTERVALS.map((i) => (
                <RadioOption
                  key={i}
                  size="compact"
                  name="billing-interval"
                  value={i}
                  checked={i === interval}
                  onChange={() => setBillingInterval(i)}
                  label={INTERVAL_CHOICE[i]}
                />
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {formatINRCompact(selectedBase)}
            {INTERVAL_LABEL[interval].per}, exclusive of 18% GST. You pay {formatINR(selectedBase + gstPaise(selectedBase))}{" "}
            with GST.
          </p>
          {offer.start === "period_end" ? (
            <p className="text-sm text-muted-foreground">
              Nothing is charged today. {payingForLabel} stays on until {paidUntilLabel}, and billing on the new
              subscription starts then.
            </p>
          ) : offer.action === "upgrade" ? (
            <p className="text-sm text-muted-foreground">
              Moving up ends your current subscription now and starts the new one, charged today. Time you already paid
              for isn&apos;t refunded, and your new plan runs for at least that long.
            </p>
          ) : payingForLabel ? (
            <p className="text-sm text-muted-foreground">
              This starts today and is charged today. Time you already paid for isn&apos;t refunded, and your new plan
              runs for at least that long.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button type="submit" className="min-h-11 w-full sm:w-auto sm:self-start" disabled={busy} aria-busy={busy && pending !== "cancel"}>
              {busy && pending !== "cancel"
                ? "Opening payment…"
                : `${ACTION_WORD[offer.action]} — ${buttonLabel(offer.plan, interval)}`}
            </Button>
            <p className="text-xs text-muted-foreground">UPI Autopay, cards or netbanking · secured by Razorpay</p>
          </div>
        </form>
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
