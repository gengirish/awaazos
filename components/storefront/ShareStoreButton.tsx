"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * "Share" pill on the public storefront header. The native share sheet is the
 * primary path on Android/iOS (WhatsApp, Instagram, SMS…); browsers without it
 * copy the store link instead. Shares the canonical `/s/<slug>` URL — never the
 * current location, which may carry a hash or query. Best-effort throughout: a
 * dismissed sheet (AbortError) or a blocked clipboard is not an error.
 */
export function ShareStoreButton({ vendorName, slug }: { vendorName: string; slug: string }) {
  const [status, setStatus] = useState<"" | "copied" | "failed">("");

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2500);
    return () => clearTimeout(t);
  }, [status]);

  async function share() {
    const url = `${window.location.origin}/s/${encodeURIComponent(slug)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: vendorName, text: `Order from ${vendorName} online`, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Share API present but refused (permission policy) — copy instead.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {status === "copied" ? (
          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {status === "copied" ? "Link copied" : status === "failed" ? "Couldn't copy" : "Share"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Store link copied" : status === "failed" ? "Couldn't copy the link" : ""}
      </span>
    </>
  );
}
