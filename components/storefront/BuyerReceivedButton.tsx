"use client";

import { Loader2, PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "I've received my order" on a delivery's order page. Tells the seller the
 * order arrived (a paid order is then marked delivered); it never marks a
 * pay-on-delivery order paid — the seller confirms the cash.
 */
export function BuyerReceivedButton({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function received() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/received`,
        { method: "POST" },
      );
      if (res.ok || res.status === 409) {
        router.refresh();
        return;
      }
      setError(res.status === 429 ? "Too many taps. Please wait a minute." : "Couldn't send that. Please try again.");
    } catch {
      setError("Couldn't reach the store — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void received()}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-background px-6 text-base font-bold text-primary hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <PackageCheck className="h-5 w-5" aria-hidden="true" />
        )}
        I&apos;ve received my order
      </button>
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
