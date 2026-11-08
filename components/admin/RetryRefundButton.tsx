"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** /admin/referrals: sends a pending free-month refund again. */
export function RetryRefundButton({ creditId }: { creditId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function retry() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/referrals/credits/${encodeURIComponent(creditId)}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMessage("Refunded");
        router.refresh();
      } else {
        setMessage(body.message ?? "Couldn't refund. Try again.");
      }
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => void retry()}>
        {busy ? "Refunding…" : "Retry refund"}
      </Button>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
