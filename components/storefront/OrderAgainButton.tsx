"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import { mergeOrderAgainLines, type OrderAgainPlan } from "@/lib/order-again";
import { cartStorageKey, parseStoredCart, serializeCart } from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

/**
 * Puts an old order's items in this device's saved cart and goes to the store,
 * where the cart bar is the next step. Blocked storage just means an empty cart.
 */
export function OrderAgainButton({
  slug,
  plan,
  billNumber,
  className,
}: {
  slug: string;
  plan: OrderAgainPlan;
  billNumber: string;
  className?: string;
}) {
  const router = useRouter();

  function orderAgain() {
    try {
      const key = cartStorageKey(slug, plan.scope);
      const now = Date.now();
      const saved = parseStoredCart(window.localStorage.getItem(key), now)?.lines ?? {};
      const raw = serializeCart(mergeOrderAgainLines(saved, plan.lines), now);
      if (raw) window.localStorage.setItem(key, raw);
    } catch {
      /* storage unavailable — the store page still opens */
    }
    router.push(`/s/${encodeURIComponent(slug)}${plan.scope.kind === "menu" ? "#menu-order" : "#drops"}`);
  }

  return (
    <div className={cn("space-y-1", className)}>
      <button
        type="button"
        onClick={orderAgain}
        aria-label={`Order again: ${billNumber}`}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-background px-4 text-sm font-bold text-primary shadow-xs transition-colors hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
        Order again
      </button>
      {plan.unavailable.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">Not available now: {plan.unavailable.join(", ")}</p>
      ) : null}
    </div>
  );
}
