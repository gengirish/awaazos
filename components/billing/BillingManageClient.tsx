"use client";

import Link from "next/link";
import { useState } from "react";

import { formatINR, formatINRCompact } from "@/lib/currency";
import {
  subscriptionBasePaise,
  subscriptionChargePaise,
  type BillingInterval,
} from "@/lib/subscription";
import { Button } from "@/components/ui/button";

const INTERVAL_LABEL: Record<BillingInterval, { button: string; per: string }> = {
  monthly: { button: "Starter monthly", per: "/month" },
  yearly: { button: "Starter yearly", per: "/year" },
};

export function BillingManageClient({
  canSubscribe,
  hasRazorpaySubscription,
  cancelAtEnd,
}: {
  /** Not on a paid plan and no subscription already collecting (trial, locked or free). */
  canSubscribe: boolean;
  hasRazorpaySubscription: boolean;
  /** Cancelled, still paid up until the cycle ends. */
  cancelAtEnd: boolean;
}) {
  // PRO is not sold (TODO.md §2): only STARTER, monthly or yearly.
  const [pending, setPending] = useState<null | "cancel" | BillingInterval>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function postJson(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as {
      error?: string;
      success?: boolean;
      shortUrl?: string;
      cancelAtEnd?: boolean;
    };
    if (!res.ok) {
      setMessage(data.error ?? "Request failed.");
      return;
    }
    if (data.shortUrl) {
      window.location.href = data.shortUrl;
      return;
    }
    setMessage(
      data.cancelAtEnd
        ? "Cancelled. Your plan stays on until the end of the period you paid for."
        : "Done. Refresh if your plan does not update immediately.",
    );
    window.setTimeout(() => window.location.reload(), 1500);
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
              onClick={() => {
                setMessage(null);
                setPending(interval);
                void postJson("/api/razorpay/create-subscription", {
                  plan: "STARTER",
                  interval,
                }).finally(() => setPending(null));
              }}
            >
              <span>{pending === interval ? "Redirecting…" : INTERVAL_LABEL[interval].button}</span>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {hasRazorpaySubscription && !cancelAtEnd ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => {
              setMessage(null);
              setPending("cancel");
              void postJson("/api/razorpay/cancel-subscription").finally(() => setPending(null));
            }}
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
      {message ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
