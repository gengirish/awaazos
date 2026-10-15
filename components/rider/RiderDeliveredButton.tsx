"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The rider's one action on /d/<token>. Asks once first: a stray tap in a
 * pocket would tell the seller (and, for cash, the books) it was handed over.
 */
export function RiderDeliveredButton({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deliver() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/d/${encodeURIComponent(token)}`, { method: "POST" });
      if (res.ok || res.status === 409) {
        // 409: someone already finished it (or the seller cancelled) — show where it stands.
        router.refresh();
        return;
      }
      setError(res.status === 429 ? "Too many taps. Wait a minute and try again." : "Couldn't save that. Try again.");
    } catch {
      setError("No internet. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-lg font-bold text-primary-foreground shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        )}
        {label}
      </button>
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Handed it over?"
        description="The seller sees it as delivered straight away."
        confirmLabel={label}
        destructive={false}
        onConfirm={() => {
          setAsking(false);
          void deliver();
        }}
      />
    </div>
  );
}
