"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Buyer pastes the UPI reference (UTR) after paying. This only records it for
 * the kitchen to check against their bank app — it does not mark the order paid.
 */
export function UtrForm({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [upiRef, setUpiRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const value = upiRef.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9]{10,22}$/.test(value)) {
      setError("Enter the 12-digit UPI reference (UTR) from your payment app.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upiRef: value }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else if (res.status === 409)
        setError("This order isn't waiting for payment any more. Refresh to see its status.");
      else if (res.status === 400)
        setError("That doesn't look like a UPI reference. Check your payment app.");
      else setError("Couldn't save that. Please try again.");
    } catch {
      setError("Couldn't reach the kitchen — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-left" noValidate>
      <Label htmlFor="utr">Paid already? Enter the UPI reference (UTR)</Label>
      <div className="flex gap-2">
        <Input
          id="utr"
          inputMode="text"
          autoComplete="off"
          value={upiRef}
          onChange={(e) => setUpiRef(e.target.value)}
          maxLength={30}
          placeholder="12-digit UTR"
          aria-describedby="utr-hint"
          className="h-11 font-mono"
        />
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          Submit
        </button>
      </div>
      <p id="utr-hint" className="text-xs text-muted-foreground">
        Find it in your UPI app under the payment details. The kitchen will confirm once they see it.
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
