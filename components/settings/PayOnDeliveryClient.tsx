"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { LastPaymentMethodNotice, lastPaymentMethodBlockersFrom } from "@/components/settings/LastPaymentMethodNotice";
import type { PaymentGuardBlocker } from "@/lib/payment-guard";

/** Whether storefront buyers may pay on delivery instead of upfront by UPI. */
export type PayOnDeliveryClientProps = {
  initialAcceptPayOnDelivery: boolean;
  hasUpiId: boolean;
  /** Told after a successful save, so sibling payment controls stay in step. */
  onChange?: (next: boolean) => void;
};

export function PayOnDeliveryClient({ initialAcceptPayOnDelivery, hasUpiId, onChange }: PayOnDeliveryClientProps) {
  const [payOnDelivery, setPayOnDelivery] = useState(initialAcceptPayOnDelivery);
  const [pending, startTransition] = useTransition();
  // Server refused to turn off the last payment method (409 last_payment_method).
  const [serverBlock, setServerBlock] = useState<PaymentGuardBlocker[] | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const blockers = lastPaymentMethodBlockersFrom(res.status, data);
        if (blockers) {
          // The switch only moves on success, so it still shows the saved state.
          setServerBlock(blockers);
          toast.error("Keep at least one way to pay while customers can order online.");
        } else {
          toast.error(data.error ?? "Could not save.");
        }
        return false;
      }
      return true;
    } catch {
      toast.error("Network error — please try again.");
      return false;
    }
  }

  function togglePayOnDelivery(next: boolean) {
    if (pending) return;
    startTransition(async () => {
      if (await patch({ acceptPayOnDelivery: next })) {
        setServerBlock(null);
        setPayOnDelivery(next);
        onChange?.(next);
        toast.success(next ? "Customers can pay on delivery." : "Customers must pay upfront by UPI.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="pay-on-delivery-toggle" className="text-sm font-medium">
            Allow pay on delivery
          </label>
          <p className="text-xs text-muted-foreground">
            {payOnDelivery
              ? "Customers can order now and pay cash or UPI when the food arrives."
              : "Customers must pay by UPI when they place an order."}
          </p>
          {!payOnDelivery && !hasUpiId ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              You have no UPI ID saved, so customers have no way to pay. Turn this on or add a UPI ID.
            </p>
          ) : null}
        </div>
        <button
          id="pay-on-delivery-toggle"
          type="button"
          role="switch"
          aria-checked={payOnDelivery}
          aria-describedby={serverBlock ? "pay-on-delivery-blocker" : undefined}
          onClick={() => togglePayOnDelivery(!payOnDelivery)}
          disabled={pending}
          className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">{payOnDelivery ? "Turn off pay on delivery" : "Turn on pay on delivery"}</span>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              payOnDelivery ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
                payOnDelivery ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>
      {serverBlock ? <LastPaymentMethodNotice id="pay-on-delivery-blocker" blockers={serverBlock} /> : null}
    </div>
  );
}
