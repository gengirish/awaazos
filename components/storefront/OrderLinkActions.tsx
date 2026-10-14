"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { rememberRecentOrder } from "@/components/storefront/recent-orders";
import { copyText } from "@/lib/clipboard";

/**
 * On the buyer's order page: "Share / copy order link", and remembering the
 * order on this device.
 *
 * The link is a guest's only way back to the order, so instead of asking them
 * to bookmark the page this offers the native share sheet (send it to
 * yourself on WhatsApp, save it to notes) with a clipboard fallback — the same
 * pattern as ShareStoreButton. It shares the canonical order URL, never the
 * current location, which may carry `?wa=1`.
 *
 * Reaching this page means the token was valid, so the order is also recorded
 * in the device's recent-orders list (recent-orders.ts: token, bill number and
 * time only). A link opened later, or on another browser, is then remembered
 * too and the store page can point back at it.
 */
export function OrderLinkActions({
  slug,
  token,
  billNumber,
  createdAt,
  vendorName,
}: {
  slug: string;
  token: string;
  billNumber: string;
  /** ISO time the order was placed. */
  createdAt: string;
  vendorName: string;
}) {
  const [status, setStatus] = useState<"" | "copied" | "failed">("");

  useEffect(() => {
    const placed = Date.parse(createdAt);
    if (Number.isNaN(placed)) return;
    rememberRecentOrder(slug, { token, billNumber, createdAt: placed });
  }, [slug, token, billNumber, createdAt]);

  async function share() {
    const url = `${window.location.origin}/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(token)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `Order ${billNumber}`, text: `My order ${billNumber} at ${vendorName}`, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Share API present but refused (permission policy) — copy instead.
      }
    }
    setStatus((await copyText(url)) ? "copied" : "failed");
  }

  return (
    <div className="space-y-2 text-center">
      <button
        type="button"
        onClick={share}
        // The "copied" note stays until the buyer moves on; nothing times it out.
        onBlur={() => setStatus("")}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-4 text-sm font-bold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        {status === "copied" ? (
          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {status === "copied" ? "Order link copied" : status === "failed" ? "Couldn't copy the link" : "Share / copy order link"}
      </button>
      <p className="text-xs text-muted-foreground">
        Keep this link to check your order later. Anyone who has it can see this order.
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Order link copied" : status === "failed" ? "Couldn't copy the order link" : ""}
      </span>
    </div>
  );
}
